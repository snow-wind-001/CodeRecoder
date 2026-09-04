<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { AlertTriangle, LoaderCircle, Power } from '@lucide/vue';
import type {
  ActivationInput,
  DesktopDashboard,
  DesktopResult,
  RestoreOutcome,
  SnapshotSummary
} from '../../shared/contracts.js';
import ActionToast from './components/ActionToast.vue';
import AppHeader from './components/AppHeader.vue';
import ProjectSetup from './components/ProjectSetup.vue';
import ProtectionSummary from './components/ProtectionSummary.vue';
import RecoveryNotice from './components/RecoveryNotice.vue';
import RestoreDrawer from './components/RestoreDrawer.vue';
import SnapshotTimeline from './components/SnapshotTimeline.vue';
import { getDesktopApi } from './services/api.js';

const api = getDesktopApi();
const dashboard = ref<DesktopDashboard | null>(null);
const booting = ref(true);
const refreshing = ref(false);
const actionBusy = ref(false);
const verifyingId = ref<string | null>(null);
const fatalError = ref('');
const refreshError = ref('');
const restoreTarget = ref<SnapshotSummary | null>(null);
const toast = ref<{ message: string; tone: 'success' | 'error' | 'info' } | null>(null);
let refreshTimer: number | undefined;
let toastTimer: number | undefined;

const busy = computed(() => booting.value || refreshing.value || actionBusy.value);

onMounted(async () => {
  await bootstrap();
  refreshTimer = window.setInterval(() => {
    if (dashboard.value?.active && !actionBusy.value && !restoreTarget.value && document.visibilityState === 'visible') {
      void refresh(true);
    }
  }, 10_000);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

async function bootstrap(): Promise<void> {
  booting.value = true;
  fatalError.value = '';
  try {
    const response = await api.bootstrap();
    if (!response.success || !response.data) {
      fatalError.value = response.error ?? response.message;
      document.title = 'CodeRecoder · Error';
      return;
    }
    dashboard.value = response.data;
    refreshError.value = '';
    document.title = 'CodeRecoder · Ready';
  } catch (error) {
    fatalError.value = error instanceof Error ? error.message : String(error);
    document.title = 'CodeRecoder · Error';
  } finally {
    booting.value = false;
  }
}

async function refresh(silent = false): Promise<void> {
  if (refreshing.value || actionBusy.value) return;
  refreshing.value = true;
  try {
    const response = await api.refresh();
    if (!response.success || !response.data) {
      refreshError.value = response.error ?? response.message;
      if (!silent) showToast(response.error ?? response.message, 'error');
      return;
    }
    dashboard.value = response.data;
    refreshError.value = '';
    if (!silent) showToast('备份状态已刷新', 'info');
  } catch (error) {
    refreshError.value = error instanceof Error ? error.message : String(error);
    if (!silent) showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    refreshing.value = false;
  }
}

async function activate(input: ActivationInput): Promise<void> {
  await runAction(
    () => api.activate(input),
    '工程保护已启动',
    true
  );
}

async function deactivate(): Promise<void> {
  await runAction(
    () => api.deactivate(true),
    '工程监控已安全停止',
    true
  );
}

async function createSnapshot(): Promise<void> {
  await runAction(
    () => api.createSnapshot({}),
    '新备份已创建并通过校验',
    true
  );
}

async function verifySnapshot(snapshot: SnapshotSummary): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  verifyingId.value = snapshot.id;
  try {
    const response = await api.verifySnapshot(snapshot.id);
    showToast(
      response.success ? '快照内容与 SHA-256 清单一致' : response.error ?? response.message,
      response.success ? 'success' : 'error'
    );
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionBusy.value = false;
    verifyingId.value = null;
  }
}

function openRestore(snapshot: SnapshotSummary): void {
  restoreTarget.value = snapshot;
}

async function handleRestoreCompleted(response: DesktopResult<RestoreOutcome>): Promise<void> {
  if (response.success) {
    restoreTarget.value = null;
    showToast('恢复完成、校验通过，安全备份已保留', 'success');
  } else if (response.data?.rollbackState === 'restored') {
    showToast('恢复失败，工程已自动回滚到操作前状态', 'info');
  } else {
    showToast(response.error ?? response.message, 'error');
  }
  await refresh(true);
}

async function runAction(
  operation: () => Promise<DesktopResult>,
  successMessage: string,
  refreshAfter: boolean
): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    const response = await operation();
    showToast(
      response.success ? successMessage : response.error ?? response.message,
      response.success ? 'success' : 'error'
    );
    if (refreshAfter) {
      const updated = await api.refresh();
      if (updated.success && updated.data) dashboard.value = updated.data;
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionBusy.value = false;
  }
}

function showToast(message: string, tone: 'success' | 'error' | 'info'): void {
  toast.value = { message, tone };
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = null;
  }, tone === 'error' ? 7000 : 4200);
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible' && dashboard.value?.active) void refresh(true);
}
</script>

<template>
  <div
    class="app-shell"
    :inert="restoreTarget !== null"
    :aria-hidden="restoreTarget !== null ? 'true' : undefined"
  >
    <AppHeader :busy="busy" @refresh="refresh(false)" />

    <div v-if="booting" class="app-loading" aria-live="polite">
      <LoaderCircle class="spin" :size="24" />
      <strong>正在连接本地备份服务</strong>
      <span>读取快照索引与恢复状态…</span>
    </div>

    <main v-else-if="fatalError && !dashboard" class="fatal-state" role="alert">
      <AlertTriangle :size="28" />
      <h1>无法启动桌面控制台</h1>
      <p>{{ fatalError }}</p>
      <button class="button button-primary" type="button" @click="bootstrap">重新连接</button>
    </main>

    <ProjectSetup
      v-else-if="dashboard && !dashboard.active"
      :dashboard="dashboard"
      :busy="actionBusy"
      @activate="activate"
      @notify="showToast"
    />

    <main v-else-if="dashboard?.active && dashboard.project" class="dashboard-view">
      <div class="project-row">
        <div class="project-copy">
          <strong>{{ dashboard.project.name }}</strong>
          <span :title="dashboard.project.root">{{ dashboard.project.root }}</span>
        </div>
        <button class="text-button" type="button" :disabled="busy" data-testid="switch-project" @click="deactivate">
          <Power :size="13" />
          切换工程
        </button>
      </div>

      <div v-if="refreshError" class="sync-warning" role="alert">
        <AlertTriangle :size="15" aria-hidden="true" />
        <span>
          <strong>状态刷新失败</strong>
          <small>{{ refreshError }}</small>
        </span>
        <button type="button" :disabled="refreshing" @click="refresh(false)">重试</button>
      </div>

      <ProtectionSummary :dashboard="dashboard" :busy="actionBusy" @backup="createSnapshot" />
      <RecoveryNotice :recovery="dashboard.recovery" />
      <SnapshotTimeline
        :snapshots="dashboard.snapshots"
        :total-count="dashboard.status?.snapshotCount ?? dashboard.snapshots.length"
        :busy="actionBusy"
        :verifying-id="verifyingId"
        @verify="verifySnapshot"
        @restore="openRestore"
      />

      <footer class="app-footer">
        <span>CodeRecoder Desktop {{ dashboard.appVersion }}</span>
        <span>本地运行 · SHA-256 校验</span>
      </footer>
    </main>

    <ActionToast
      v-if="toast"
      :message="toast.message"
      :tone="toast.tone"
      @close="toast = null"
    />

    <RestoreDrawer
      :open="restoreTarget !== null"
      :snapshot="restoreTarget"
      @close="restoreTarget = null"
      @completed="handleRestoreCompleted"
    />
  </div>
</template>
