<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  AlertTriangle,
  ChevronRight,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  X
} from '@lucide/vue';
import type {
  DesktopResult,
  RestoreMode,
  RestoreOutcome,
  RestorePreview,
  SnapshotSummary
} from '../../../shared/contracts.js';
import { getDesktopApi } from '../services/api.js';
import { formatDate } from '../services/format.js';

const props = defineProps<{
  open: boolean;
  projectId: string | null;
  snapshot: SnapshotSummary | null;
}>();

const emit = defineEmits<{
  close: [];
  completed: [response: DesktopResult<RestoreOutcome>];
}>();

const dialog = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const mode = ref<RestoreMode>('exact');
const preview = ref<RestorePreview | null>(null);
const loading = ref(false);
const restoring = ref(false);
const error = ref('');
const now = ref(Date.now());
let previousFocus: HTMLElement | null = null;
let previewSequence = 0;
let clock: ReturnType<typeof setInterval> | undefined;

const secondsRemaining = computed(() => {
  if (!preview.value) return 0;
  return Math.max(0, Math.ceil((preview.value.expiresAt - now.value) / 1000));
});

const previewPaths = computed(() => {
  if (!preview.value) return [];
  return [
    ...preview.value.changes.added.map(file => ({ kind: '新增', file })),
    ...preview.value.changes.modified.map(file => ({ kind: '修改', file })),
    ...preview.value.changes.deleted.map(file => ({ kind: '删除', file })),
    ...preview.value.changes.renamed.map(file => ({ kind: '重命名', file: `${file.from} → ${file.to}` }))
  ].slice(0, 12);
});

const affectedPathCount = computed(() => {
  if (!preview.value) return 0;
  return preview.value.changes.added.length
    + preview.value.changes.modified.length
    + preview.value.changes.deleted.length
    + preview.value.changes.renamed.length;
});

const hiddenPathCount = computed(() => Math.max(0, affectedPathCount.value - previewPaths.value.length));

const canConfirm = computed(() => {
  return preview.value !== null
    && secondsRemaining.value > 0
    && !loading.value
    && !restoring.value;
});

watch(
  () => props.open,
  async open => {
    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      mode.value = 'exact';
      preview.value = null;
      error.value = '';
      now.value = Date.now();
      clock = setInterval(() => {
        now.value = Date.now();
      }, 1000);
      await nextTick();
      closeButton.value?.focus();
      await loadPreview();
    } else {
      clearClock();
      previewSequence++;
      const focusTarget = previousFocus;
      previousFocus = null;
      await nextTick();
      focusTarget?.focus();
    }
  }
);

watch(mode, async () => {
  if (props.open) await loadPreview();
});

onBeforeUnmount(clearClock);

async function loadPreview(): Promise<void> {
  if (!props.snapshot || !props.projectId) return;
  const sequence = ++previewSequence;
  loading.value = true;
  preview.value = null;
  error.value = '';
  try {
    const response = await getDesktopApi().previewRestore({
      projectId: props.projectId,
      snapshotId: props.snapshot.id,
      mode: mode.value
    });
    if (sequence !== previewSequence) return;
    if (!response.success || !response.data) {
      error.value = response.error ?? response.message;
      return;
    }
    preview.value = response.data;
    now.value = Date.now();
  } catch (caught) {
    if (sequence === previewSequence) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  } finally {
    if (sequence === previewSequence) loading.value = false;
  }
}

async function confirmRestore(): Promise<void> {
  if (!props.snapshot || !props.projectId || !preview.value || !canConfirm.value) return;
  restoring.value = true;
  error.value = '';
  try {
    const response = await getDesktopApi().restoreSnapshot({
      projectId: props.projectId,
      snapshotId: props.snapshot.id,
      confirmationToken: preview.value.confirmationToken
    });
    if (!response.success) {
      const rollback = response.data?.rollbackState;
      error.value = rollback === 'restored'
        ? '恢复失败，但工程已自动回滚到操作前状态。'
        : response.error ?? response.message;
    }
    emit('completed', response);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    restoring.value = false;
  }
}

function requestClose(): void {
  if (!restoring.value) emit('close');
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    requestClose();
    return;
  }
  if (event.key !== 'Tab' || !dialog.value) return;
  const focusable = Array.from(dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
  if (focusable.length === 0) return;
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

function clearClock(): void {
  if (clock) clearInterval(clock);
  clock = undefined;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div
        v-if="open"
        class="restore-overlay"
        data-testid="restore-overlay"
        @mousedown.self="requestClose"
      >
        <section
          ref="dialog"
          class="restore-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-title"
          aria-describedby="restore-description"
          @keydown="handleKeydown"
        >
          <div class="drawer-handle" aria-hidden="true"></div>
          <header class="drawer-heading">
            <div>
              <h2 id="restore-title">恢复到此快照</h2>
              <p v-if="snapshot">{{ formatDate(snapshot.createdAt) }} · {{ snapshot.totalFiles }} 个文件</p>
            </div>
            <button ref="closeButton" class="drawer-close" type="button" :disabled="restoring" aria-label="关闭恢复预览" @click="requestClose">
              <X :size="16" />
            </button>
          </header>

          <p id="restore-description" class="drawer-description">
            系统会先验证目标，再创建一次受保护的安全备份。只有校验成功后才会完成恢复。
          </p>

          <div class="restore-modes" role="group" aria-label="恢复模式">
            <button
              type="button"
              :class="{ active: mode === 'exact' }"
              :disabled="loading || restoring"
              :aria-pressed="mode === 'exact'"
              @click="mode = 'exact'"
            >
              <strong>精确恢复</strong>
              <span>同步到快照状态</span>
            </button>
            <button
              type="button"
              :class="{ active: mode === 'overlay' }"
              :disabled="loading || restoring"
              :aria-pressed="mode === 'overlay'"
              @click="mode = 'overlay'"
            >
              <strong>覆盖恢复</strong>
              <span>保留额外文件</span>
            </button>
          </div>

          <div v-if="loading" class="preview-loading" aria-live="polite">
            <LoaderCircle class="spin" :size="18" />
            正在验证快照并计算变更…
          </div>

          <template v-else-if="preview">
            <div class="change-counts" aria-label="恢复变更统计">
              <div><b>{{ preview.counts.added }}</b><span>新增</span></div>
              <div><b>{{ preview.counts.modified }}</b><span>修改</span></div>
              <div><b>{{ preview.counts.deleted }}</b><span>删除</span></div>
              <div><b>{{ preview.counts.renamed }}</b><span>重命名</span></div>
            </div>

            <details v-if="previewPaths.length" class="change-paths">
              <summary>
                查看受影响路径（{{ affectedPathCount }}）
                <ChevronRight :size="13" aria-hidden="true" />
              </summary>
              <ul>
                <li v-for="item in previewPaths" :key="`${item.kind}-${item.file}`">
                  <span>{{ item.kind }}</span>
                  <code>{{ item.file }}</code>
                </li>
                <li v-if="hiddenPathCount" class="change-paths-more">
                  <span>其余</span>
                  <code>另有 {{ hiddenPathCount }} 个路径，完整清单保留在恢复预览中</code>
                </li>
              </ul>
            </details>

            <div class="restore-safety">
              <AlertTriangle :size="15" aria-hidden="true" />
              <span v-if="mode === 'exact'">精确恢复会移除快照中不存在的受管代码；Git、环境文件和其他排除项不会被删除。</span>
              <span v-else>覆盖恢复只写入快照包含的路径，不会删除工程中的额外代码。</span>
            </div>

            <div class="token-expiry" :class="{ expired: secondsRemaining === 0 }">
              {{ secondsRemaining > 0 ? `确认令牌剩余 ${secondsRemaining} 秒` : '确认令牌已失效，请重新生成预览' }}
            </div>
          </template>

          <div v-if="error" class="drawer-error" role="alert">
            <AlertTriangle :size="15" />
            <span>{{ error }}</span>
            <button v-if="!restoring" type="button" @click="loadPreview">重新预览</button>
          </div>

          <button
            class="button button-primary confirm-restore"
            type="button"
            :disabled="!canConfirm"
            data-testid="confirm-restore"
            @click="confirmRestore"
          >
            <LoaderCircle v-if="restoring" class="spin" :size="16" />
            <ShieldCheck v-else :size="16" />
            {{ restoring ? '正在恢复并校验…' : '确认恢复并保留安全备份' }}
          </button>
          <button v-if="preview && secondsRemaining === 0" class="button button-secondary renew-preview" type="button" @click="loadPreview">
            <RotateCcw :size="14" />重新生成预览
          </button>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
