<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FolderOpen, HardDrive, LoaderCircle, ShieldCheck } from '@lucide/vue';
import type { ActivationInput, DesktopDashboard, DirectoryKind } from '../../../shared/contracts.js';
import { getDesktopApi } from '../services/api.js';

const props = defineProps<{
  dashboard: DesktopDashboard;
  busy: boolean;
}>();

const emit = defineEmits<{
  activate: [input: ActivationInput];
  notify: [message: string, tone: 'error' | 'info'];
}>();

const projectPath = ref('');
const storageRoot = ref('');
const autoCheckpoint = ref(true);
const maxBackups = ref(100);

const applyDashboardDefaults = (): void => {
  const saved = props.dashboard.savedSetup;
  projectPath.value = saved?.projectPath ?? '';
  storageRoot.value = saved?.storageRoot ?? props.dashboard.defaultStorageRoot;
  autoCheckpoint.value = saved?.autoCheckpoint ?? true;
  maxBackups.value = saved?.maxBackups ?? 100;
};

watch(() => props.dashboard, applyDashboardDefaults, { immediate: true });

const canActivate = computed(() => projectPath.value.length > 0 && storageRoot.value.length > 0 && !props.busy);

async function chooseDirectory(kind: DirectoryKind): Promise<void> {
  try {
    const response = await getDesktopApi().chooseDirectory(kind);
    if (!response.success) {
      emit('notify', response.error ?? response.message, 'error');
      return;
    }
    const selectedPath = response.data?.path;
    if (!selectedPath) return;
    if (kind === 'project') projectPath.value = selectedPath;
    else storageRoot.value = selectedPath;
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : String(error), 'error');
  }
}

function activate(): void {
  if (!canActivate.value) return;
  emit('activate', {
    projectPath: projectPath.value,
    storageRoot: storageRoot.value,
    autoCheckpoint: autoCheckpoint.value,
    maxBackups: maxBackups.value
  });
}
</script>

<template>
  <main class="setup-view">
    <section class="setup-intro">
      <div class="setup-icon" aria-hidden="true">
        <ShieldCheck :size="26" :stroke-width="1.7" />
      </div>
      <h1>开始保护代码</h1>
      <p>选择工程和外部备份目录。CodeRecoder 不会要求工程接入 Git，也不会注入源代码。</p>
    </section>

    <section class="setup-form" aria-labelledby="setup-heading">
      <h2 id="setup-heading">保护范围</h2>

      <button
        class="directory-picker"
        type="button"
        :disabled="busy"
        data-testid="choose-project"
        @click="chooseDirectory('project')"
      >
        <span class="picker-icon"><FolderOpen :size="17" /></span>
        <span class="picker-copy">
          <small>需要保护的工程</small>
          <strong>{{ projectPath || '选择工程目录' }}</strong>
        </span>
        <span class="picker-action">选择</span>
      </button>

      <button
        class="directory-picker"
        type="button"
        :disabled="busy"
        data-testid="choose-storage"
        @click="chooseDirectory('storage')"
      >
        <span class="picker-icon"><HardDrive :size="17" /></span>
        <span class="picker-copy">
          <small>外部备份位置</small>
          <strong>{{ storageRoot || dashboard.defaultStorageRoot }}</strong>
        </span>
        <span class="picker-action">更改</span>
      </button>

      <div class="setup-note">
        备份数据默认保存在应用数据目录，不会向受保护工程写入元数据。
      </div>

      <label class="setting-row">
        <span>
          <strong>自动检查点</strong>
          <small>文件变更后自动防抖备份</small>
        </span>
        <input v-model="autoCheckpoint" class="switch-input" type="checkbox" :disabled="busy" />
        <span class="switch" aria-hidden="true"></span>
      </label>

      <label class="setting-row">
        <span>
          <strong>最多保留</strong>
          <small>受保护的恢复前快照不受此限制</small>
        </span>
        <select v-model.number="maxBackups" :disabled="busy" aria-label="最多保留的普通快照数量">
          <option :value="25">25 个</option>
          <option :value="50">50 个</option>
          <option :value="100">100 个</option>
          <option :value="250">250 个</option>
        </select>
      </label>
    </section>

    <button
      class="button button-primary setup-submit"
      type="button"
      :disabled="!canActivate"
      data-testid="activate-button"
      @click="activate"
    >
      <LoaderCircle v-if="busy" class="spin" :size="16" />
      <ShieldCheck v-else :size="16" />
      {{ busy ? '正在建立基线…' : '启动保护' }}
    </button>
  </main>
</template>
