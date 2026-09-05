<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, LoaderCircle, PlugZap, RotateCw, Settings2, Sparkles } from '@lucide/vue';
import type { SerenaStatus } from '../../../shared/contracts.js';

const props = defineProps<{
  status: SerenaStatus;
  backupProtected: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  settings: [];
}>();

const presentation = computed(() => {
  switch (props.status.state) {
    case 'ready':
      return { tone: 'ready', label: 'MCP 已就绪', title: 'Serena 已连接', icon: PlugZap };
    case 'checking':
    case 'configuring':
    case 'starting':
      return { tone: 'busy', label: '正在握手', title: props.status.state === 'configuring' ? '正在配置工程' : '正在启动 Serena', icon: LoaderCircle };
    case 'degraded':
      return { tone: 'warning', label: '辅助能力降级', title: 'Serena 需要处理', icon: AlertTriangle };
    case 'disabled':
      return { tone: 'muted', label: '未启用', title: 'Serena 已关闭', icon: Sparkles };
    default:
      return { tone: 'muted', label: '会话已停止', title: 'Serena 未运行', icon: Sparkles };
  }
});

const endpointLabel = computed(() => {
  if (!props.status.endpoint) return null;
  try {
    const endpoint = new URL(props.status.endpoint);
    return `${endpoint.hostname}:${endpoint.port}/mcp`;
  } catch {
    return props.status.endpoint;
  }
});

const isWorking = computed(() => ['checking', 'configuring', 'starting'].includes(props.status.state));
</script>

<template>
  <section class="serena-card" :class="`tone-${presentation.tone}`" aria-labelledby="serena-title">
    <div class="serena-icon" aria-hidden="true">
      <component :is="presentation.icon" :class="{ spin: isWorking }" :size="16" />
    </div>
    <div class="serena-copy">
      <div class="serena-label"><span>{{ presentation.label }}</span><i></i></div>
      <strong id="serena-title">{{ presentation.title }}</strong>
      <p v-if="status.state === 'ready' && endpointLabel"><code>{{ endpointLabel }}</code> · 当前会话临时地址</p>
      <p v-else-if="status.lastError" :title="status.lastError">{{ status.lastError }}</p>
      <p v-else>{{ backupProtected ? '代码备份保护独立运行，不依赖 Serena。' : '启动工程保护时会尝试建立独立会话。' }}</p>
    </div>
    <div class="serena-actions">
      <button type="button" aria-label="打开 MCP 设置" @click="emit('settings')"><Settings2 :size="14" /></button>
      <button
        v-if="status.enabled && status.state !== 'ready'"
        type="button"
        :disabled="busy || isWorking"
        aria-label="重新检测并启动 Serena"
        @click="emit('retry')"
      ><RotateCw :class="{ spin: isWorking }" :size="14" /></button>
    </div>
  </section>
</template>
