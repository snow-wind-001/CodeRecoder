<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clipboard,
  LoaderCircle,
  RefreshCw,
  TerminalSquare,
  X,
  XCircle
} from '@lucide/vue';
import type {
  McpClientTarget,
  McpEnvironmentReport,
  McpRecommendation,
  McpServiceTarget
} from '../../../shared/contracts.js';
import { getDesktopApi } from '../services/api.js';

const props = defineProps<{
  open: boolean;
  projectId: string | null;
  projectName: string | null;
}>();

const emit = defineEmits<{
  close: [];
  notify: [message: string, tone: 'success' | 'error' | 'info'];
}>();

const clients: Array<{ id: McpClientTarget; label: string }> = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude-code', label: 'Claude' },
  { id: 'codex', label: 'Codex' }
];
const target = ref<McpClientTarget>('vscode');
const service = ref<McpServiceTarget>('coderecorder');
const environment = ref<McpEnvironmentReport | null>(null);
const recommendation = ref<McpRecommendation | null>(null);
const checking = ref(false);
const loadingSnippet = ref(false);
const copied = ref(false);
const error = ref('');
const closeButton = ref<HTMLButtonElement | null>(null);
const drawer = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let requestSequence = 0;

const availableCount = computed(() => environment.value?.items.filter(item => item.status === 'available').length ?? 0);

watch(() => props.open, async open => {
  if (!open) {
    requestSequence += 1;
    const focusTarget = previousFocus;
    previousFocus = null;
    await nextTick();
    focusTarget?.focus();
    return;
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  copied.value = false;
  error.value = '';
  await nextTick();
  closeButton.value?.focus();
  await Promise.all([inspect(), loadRecommendation()]);
});

onBeforeUnmount(() => previousFocus?.focus());

watch([target, service], async () => {
  if (!props.open) return;
  copied.value = false;
  await loadRecommendation();
});

watch(() => props.projectId, async () => {
  if (!props.open) return;
  if (!props.projectId && service.value === 'serena') service.value = 'coderecorder';
  await Promise.all([inspect(), loadRecommendation()]);
});

async function inspect(): Promise<void> {
  checking.value = true;
  try {
    const response = await getDesktopApi().inspectMcpEnvironment(props.projectId ?? undefined);
    if (!response.success || !response.data) throw new Error(response.error ?? response.message);
    environment.value = response.data;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    checking.value = false;
  }
}

async function loadRecommendation(): Promise<void> {
  if (service.value === 'serena' && !props.projectId) {
    recommendation.value = null;
    error.value = '选择工程后才能生成 Serena 配置。';
    return;
  }
  const sequence = ++requestSequence;
  loadingSnippet.value = true;
  error.value = '';
  try {
    const response = await getDesktopApi().getMcpRecommendation({
      target: target.value,
      service: service.value,
      projectId: props.projectId ?? undefined
    });
    if (sequence !== requestSequence) return;
    if (!response.success || !response.data) throw new Error(response.error ?? response.message);
    recommendation.value = response.data;
  } catch (caught) {
    if (sequence === requestSequence) {
      recommendation.value = null;
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  } finally {
    if (sequence === requestSequence) loadingSnippet.value = false;
  }
}

async function copyRecommendation(): Promise<void> {
  try {
    const response = await getDesktopApi().copyMcpRecommendation({
      target: target.value,
      service: service.value,
      projectId: props.projectId ?? undefined
    });
    if (!response.success) throw new Error(response.error ?? response.message);
    copied.value = true;
    emit('notify', '配置建议已复制；现有客户端配置未被修改', 'success');
    window.setTimeout(() => { copied.value = false; }, 2200);
  } catch (caught) {
    emit('notify', caught instanceof Error ? caught.message : String(caught), 'error');
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key !== 'Tab' || !drawer.value) return;
  const focusable = Array.from(drawer.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="settings">
      <div v-if="open" class="settings-overlay" @mousedown.self="emit('close')">
        <aside ref="drawer" class="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="mcp-settings-title" @keydown="handleKeydown">
          <header class="settings-heading">
            <div class="settings-heading-icon"><TerminalSquare :size="17" /></div>
            <div>
              <span class="eyebrow">Integration desk</span>
              <h2 id="mcp-settings-title">MCP 连接设置</h2>
              <p>{{ projectName ? `当前工程 · ${projectName}` : '通用 CodeRecoder 配置' }}</p>
            </div>
            <button ref="closeButton" class="drawer-close" type="button" aria-label="关闭 MCP 设置" @click="emit('close')"><X :size="16" /></button>
          </header>

          <section class="environment-panel" aria-labelledby="environment-title">
            <div class="settings-section-title">
              <div><span class="eyebrow">Preflight</span><strong id="environment-title">环境检查</strong></div>
              <button type="button" :disabled="checking" @click="inspect">
                <LoaderCircle v-if="checking" class="spin" :size="13" />
                <RefreshCw v-else :size="13" /> 复查
              </button>
            </div>
            <div v-if="environment" class="environment-summary" :class="{ ready: environment.ready }">
              <span :class="{ ready: environment.ready }"><CheckCircle2 :size="14" /> 核心 {{ environment.ready ? '就绪' : '待处理' }}</span>
              <small>{{ availableCount }} / {{ environment.items.length }} 个组件可用</small>
            </div>
            <div class="environment-grid">
              <div v-for="item in environment?.items" :key="item.id" class="environment-item" :class="`state-${item.status}`" :title="item.path ?? item.detail">
                <CheckCircle2 v-if="item.status === 'available'" :size="14" />
                <AlertTriangle v-else-if="item.status === 'warning'" :size="14" />
                <XCircle v-else :size="14" />
                <span><b>{{ item.label }}</b><small>{{ item.version || item.detail }}</small></span>
              </div>
            </div>
          </section>

          <section class="configuration-panel" aria-labelledby="configuration-title">
            <div class="settings-section-title">
              <div><span class="eyebrow">Connection recipe</span><strong id="configuration-title">配置建议</strong></div>
            </div>
            <div class="segmented-control client-tabs" role="tablist" aria-label="MCP 客户端">
              <button v-for="client in clients" :key="client.id" type="button" role="tab" :aria-selected="target === client.id" :class="{ active: target === client.id }" @click="target = client.id">{{ client.label }}</button>
            </div>
            <div class="segmented-control service-tabs" role="group" aria-label="服务类型">
              <button type="button" :aria-pressed="service === 'coderecorder'" :class="{ active: service === 'coderecorder' }" @click="service = 'coderecorder'">CodeRecoder</button>
              <button type="button" :disabled="!projectId" :aria-pressed="service === 'serena'" :class="{ active: service === 'serena' }" @click="service = 'serena'">Serena</button>
            </div>

            <div v-if="loadingSnippet" class="snippet-loading"><LoaderCircle class="spin" :size="16" /> 正在生成本机路径配置…</div>
            <template v-else-if="recommendation">
              <div class="config-meta"><span>{{ recommendation.configPath }}</span><small>{{ recommendation.format.toUpperCase() }}</small></div>
              <pre class="config-snippet"><code>{{ recommendation.content }}</code></pre>
              <button class="button button-primary copy-config" type="button" @click="copyRecommendation">
                <Check v-if="copied" :size="15" /><Clipboard v-else :size="15" />
                {{ copied ? '已复制' : '复制配置建议' }}
              </button>
              <div v-if="recommendation.endpointIsTemporary" class="endpoint-warning">
                <AlertTriangle :size="14" />
                <span><strong>临时 HTTP endpoint</strong><code>{{ recommendation.endpoint }}</code>仅当前 Electron 工程会话有效，请勿保存为长期配置。</span>
              </div>
              <ul class="recommendation-notes"><li v-for="note in recommendation.notes" :key="note">{{ note }}</li></ul>
            </template>
            <div v-if="error" class="drawer-error" role="alert"><AlertTriangle :size="15" /><span>{{ error }}</span></div>
          </section>

          <footer class="settings-footer">只生成和复制建议，不会静默覆盖 VS Code、Cursor、Claude Code 或 Codex 的配置文件。</footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>
