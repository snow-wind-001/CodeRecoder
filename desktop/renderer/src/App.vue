<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AlertTriangle,
  ExternalLink,
  LoaderCircle,
  Play,
  Power,
  ShieldOff,
  Trash2
} from '@lucide/vue';
import type {
  DesktopDashboard,
  DesktopResult,
  ProjectRegistrationInput,
  RestoreOutcome,
  SnapshotSummary
} from '../../shared/contracts.js';
import ActionToast from './components/ActionToast.vue';
import AppHeader from './components/AppHeader.vue';
import McpSettingsDrawer from './components/McpSettingsDrawer.vue';
import ProjectSetup from './components/ProjectSetup.vue';
import ProjectSwitcher from './components/ProjectSwitcher.vue';
import ProtectionSummary from './components/ProtectionSummary.vue';
import RecoveryNotice from './components/RecoveryNotice.vue';
import RestoreDrawer from './components/RestoreDrawer.vue';
import SerenaStatusCard from './components/SerenaStatusCard.vue';
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
const settingsOpen = ref(false);
const setupOpen = ref(false);
const addDialog = ref<HTMLElement | null>(null);
const toast = ref<{ message: string; tone: 'success' | 'error' | 'info' } | null>(null);
let refreshTimer: number | undefined;
let eventRefreshTimer: number | undefined;
let toastTimer: number | undefined;
let unsubscribeState: (() => void) | undefined;
let addPreviousFocus: HTMLElement | null = null;

const selectedProject = computed(() => dashboard.value?.selectedProject ?? null);
const selectedId = computed(() => dashboard.value?.selectedProjectId ?? null);
const isMainWindow = computed(() => dashboard.value?.window.kind !== 'project');
const busy = computed(() => booting.value || refreshing.value || actionBusy.value);
const overlayOpen = computed(() => restoreTarget.value !== null || settingsOpen.value || setupOpen.value);
const projectIsRunning = computed(() => {
  const state = selectedProject.value?.project.protectionState;
  return state === 'running' || state === 'degraded' || state === 'starting';
});

watch(setupOpen, async open => {
  if (open) {
    addPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    addDialog.value?.querySelector<HTMLButtonElement>('button')?.focus();
    return;
  }
  const focusTarget = addPreviousFocus;
  addPreviousFocus = null;
  await nextTick();
  focusTarget?.focus();
});

onMounted(async () => {
  await bootstrap();
  unsubscribeState = api.onStateChanged(event => {
    if (
      dashboard.value?.window.kind === 'project'
      && event.projectId
      && event.projectId !== dashboard.value.window.projectId
    ) return;
    if (eventRefreshTimer) window.clearTimeout(eventRefreshTimer);
    eventRefreshTimer = window.setTimeout(() => void refresh(true), 220);
  });
  refreshTimer = window.setInterval(() => {
    if (dashboard.value?.projects.length && !actionBusy.value && !restoreTarget.value && document.visibilityState === 'visible') {
      void refresh(true);
    }
  }, 12_000);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (eventRefreshTimer) window.clearTimeout(eventRefreshTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
  unsubscribeState?.();
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
    document.title = response.data.window.kind === 'project' && response.data.selectedProject
      ? `CodeRecoder · ${response.data.selectedProject.project.name}`
      : 'CodeRecoder · Ready';
  } catch (error) {
    fatalError.value = error instanceof Error ? error.message : String(error);
    document.title = 'CodeRecoder · Error';
  } finally {
    booting.value = false;
  }
}

async function refresh(silent = false, projectId?: string): Promise<void> {
  if (refreshing.value || actionBusy.value) return;
  refreshing.value = true;
  try {
    const response = await api.refresh(projectId);
    if (!response.success || !response.data) {
      refreshError.value = response.error ?? response.message;
      if (!silent) showToast(refreshError.value, 'error');
      return;
    }
    dashboard.value = response.data;
    refreshError.value = '';
    if (!silent) showToast('全部状态已刷新', 'info');
  } catch (error) {
    refreshError.value = error instanceof Error ? error.message : String(error);
    if (!silent) showToast(refreshError.value, 'error');
  } finally {
    refreshing.value = false;
  }
}

async function registerProject(input: ProjectRegistrationInput): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    const response = await api.registerProject(input);
    if (response.data?.projectId) {
      setupOpen.value = false;
      const updated = await api.refresh(response.data.projectId);
      if (updated.success && updated.data) dashboard.value = updated.data;
    }
    showToast(response.success ? response.message : response.error ?? response.message, response.success ? 'success' : 'error');
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionBusy.value = false;
  }
}

async function selectProject(projectId: string): Promise<void> {
  if (!isMainWindow.value || actionBusy.value || projectId === selectedId.value) return;
  restoreTarget.value = null;
  actionBusy.value = true;
  try {
    const response = await api.selectProject(projectId);
    if (!response.success || !response.data) throw new Error(response.error ?? response.message);
    dashboard.value = response.data;
    refreshError.value = '';
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionBusy.value = false;
  }
}

async function startProject(): Promise<void> {
  const projectId = selectedId.value;
  if (!projectId) return;
  await runAction(() => api.startProject(projectId), '工程保护已启动');
}

async function stopProject(): Promise<void> {
  const projectId = selectedId.value;
  if (!projectId) return;
  await runAction(
    () => api.stopProject({ projectId, createFinalCheckpoint: true }),
    '已创建最终检查点并停止此工程'
  );
}

async function removeProject(): Promise<void> {
  const project = selectedProject.value?.project;
  if (!project || !isMainWindow.value || actionBusy.value) return;
  const confirmed = window.confirm(`从控制台移除“${project.name}”？\n\n将先创建最终检查点并停止会话；现有备份不会删除。`);
  if (!confirmed) return;
  await runAction(
    () => api.removeProject({ projectId: project.id, createFinalCheckpoint: true }),
    '工程已从控制台移除，备份仍然保留'
  );
}

async function openProjectWindow(): Promise<void> {
  if (!selectedId.value) return;
  await runAction(() => api.openProjectWindow(selectedId.value as string), '独立工程窗口已打开', false);
}

async function createSnapshot(): Promise<void> {
  if (!selectedId.value) return;
  await runAction(
    () => api.createSnapshot({ projectId: selectedId.value as string }),
    '新备份已创建并通过校验'
  );
}

async function verifySnapshot(snapshot: SnapshotSummary): Promise<void> {
  if (actionBusy.value || !selectedId.value) return;
  actionBusy.value = true;
  verifyingId.value = snapshot.id;
  try {
    const response = await api.verifySnapshot({ projectId: selectedId.value, snapshotId: snapshot.id });
    showToast(response.success ? '快照内容与 SHA-256 清单一致' : response.error ?? response.message, response.success ? 'success' : 'error');
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionBusy.value = false;
    verifyingId.value = null;
  }
}

async function restartSerena(): Promise<void> {
  if (!selectedId.value || actionBusy.value) return;
  await runAction(() => api.restartSerena(selectedId.value as string), 'Serena 已连接并通过握手');
}

function openRestore(snapshot: SnapshotSummary): void {
  if (projectIsRunning.value) restoreTarget.value = snapshot;
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
  refreshAfter = true
): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    const response = await operation();
    showToast(response.success ? successMessage : response.error ?? response.message, response.success ? 'success' : 'error');
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
  toastTimer = window.setTimeout(() => { toast.value = null; }, tone === 'error' ? 7000 : 4200);
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible' && dashboard.value?.projects.length) void refresh(true);
}

function handleAddDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    setupOpen.value = false;
    return;
  }
  if (event.key !== 'Tab' || !addDialog.value) return;
  const focusable = Array.from(addDialog.value.querySelectorAll<HTMLElement>(
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
  <div class="app-shell" :inert="overlayOpen" :aria-hidden="overlayOpen ? 'true' : undefined">
    <AppHeader
      :busy="busy"
      :can-add="Boolean(dashboard && isMainWindow)"
      @refresh="refresh(false)"
      @add="setupOpen = true"
      @settings="settingsOpen = true"
    />

    <div v-if="booting" class="app-loading" aria-live="polite">
      <LoaderCircle class="spin" :size="24" />
      <strong>正在恢复工程会话</strong>
      <span>检查快照索引、文件监听与 Serena 握手…</span>
    </div>

    <main v-else-if="fatalError && !dashboard" class="fatal-state" role="alert">
      <AlertTriangle :size="28" />
      <h1>无法启动桌面控制台</h1>
      <p>{{ fatalError }}</p>
      <button class="button button-primary" type="button" @click="bootstrap">重新连接</button>
    </main>

    <ProjectSetup
      v-else-if="dashboard && dashboard.projects.length === 0 && isMainWindow"
      :default-storage-root="dashboard.defaultStorageRoot"
      :busy="actionBusy"
      @register="registerProject"
      @notify="showToast"
    />

    <main v-else-if="dashboard" class="dashboard-view">
      <ProjectSwitcher
        v-if="isMainWindow && dashboard.projects.length"
        :projects="dashboard.projects"
        :selected-id="selectedId"
        :busy="actionBusy"
        @select="selectProject"
        @add="setupOpen = true"
      />

      <template v-if="selectedProject">
        <div class="project-row project-context-row">
          <div class="project-copy">
            <span class="eyebrow">{{ isMainWindow ? 'Selected project' : 'Dedicated project window' }}</span>
            <strong>{{ selectedProject.project.name }}</strong>
            <span :title="selectedProject.project.root">{{ selectedProject.project.root }}</span>
          </div>
          <div class="project-actions">
            <button v-if="isMainWindow" type="button" :disabled="busy" aria-label="在独立窗口打开" title="在独立窗口打开" @click="openProjectWindow"><ExternalLink :size="14" /></button>
            <button v-if="projectIsRunning" type="button" :disabled="busy" aria-label="安全停止工程" title="创建最终检查点并停止" @click="stopProject"><Power :size="14" /></button>
            <button v-else type="button" :disabled="busy" aria-label="启动工程保护" title="启动工程保护" @click="startProject"><Play :size="14" /></button>
            <button v-if="isMainWindow" class="danger-action" type="button" :disabled="busy" aria-label="从控制台移除" title="从控制台移除（保留备份）" @click="removeProject"><Trash2 :size="14" /></button>
          </div>
        </div>

        <div v-if="refreshError" class="sync-warning" role="alert">
          <AlertTriangle :size="15" aria-hidden="true" />
          <span><strong>状态刷新失败</strong><small>{{ refreshError }}</small></span>
          <button type="button" :disabled="refreshing" @click="refresh(false)">重试</button>
        </div>

        <section v-if="selectedProject.project.protectionState === 'stopped'" class="session-stopped-card">
          <div><ShieldOff :size="18" /><span><strong>工程保护已停止</strong><small>{{ selectedProject.project.lastError || '历史备份仍保留；启动后会先验证存储并建立新基线。' }}</small></span></div>
          <button class="button button-primary" type="button" :disabled="busy" @click="startProject"><Play :size="14" />启动保护</button>
        </section>
        <ProtectionSummary v-else :project="selectedProject" :busy="actionBusy" @backup="createSnapshot" />

        <SerenaStatusCard
          :status="selectedProject.project.serena"
          :backup-protected="projectIsRunning"
          :busy="actionBusy"
          @retry="restartSerena"
          @settings="settingsOpen = true"
        />
        <RecoveryNotice :recovery="selectedProject.recovery" />
        <SnapshotTimeline
          :snapshots="selectedProject.snapshots"
          :total-count="selectedProject.project.snapshotCount"
          :busy="actionBusy || !projectIsRunning"
          :verifying-id="verifyingId"
          @verify="verifySnapshot"
          @restore="openRestore"
        />
      </template>

      <div v-else class="empty-state project-unavailable">
        <ShieldOff :size="24" />
        <strong>工程会话不可用</strong>
        <span>此独立窗口绑定的工程可能已经从主窗口移除。</span>
      </div>

      <footer class="app-footer">
        <span>CodeRecoder Desktop {{ dashboard.appVersion }}</span>
        <span>单实例 · {{ dashboard.projects.length }} 个工程</span>
      </footer>
    </main>

    <ActionToast v-if="toast" :message="toast.message" :tone="toast.tone" @close="toast = null" />

    <RestoreDrawer
      :open="restoreTarget !== null"
      :project-id="selectedId"
      :snapshot="restoreTarget"
      @close="restoreTarget = null"
      @completed="handleRestoreCompleted"
    />
    <McpSettingsDrawer
      :open="settingsOpen"
      :project-id="selectedId"
      :project-name="selectedProject?.project.name ?? null"
      @close="settingsOpen = false"
      @notify="showToast"
    />

    <Teleport to="body">
      <Transition name="settings">
        <div v-if="setupOpen && dashboard" class="settings-overlay add-project-overlay" @mousedown.self="setupOpen = false" @keydown.esc="setupOpen = false">
          <section ref="addDialog" class="add-project-drawer" role="dialog" aria-modal="true" aria-label="添加保护工程" tabindex="-1" @keydown="handleAddDialogKeydown">
            <ProjectSetup
              embedded
              :default-storage-root="dashboard.defaultStorageRoot"
              :busy="actionBusy"
              @register="registerProject"
              @cancel="setupOpen = false"
              @notify="showToast"
            />
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
