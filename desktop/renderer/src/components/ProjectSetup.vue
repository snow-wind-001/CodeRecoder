<script setup lang="ts">
import { computed, ref } from 'vue';
import { FolderOpen, HardDrive, LoaderCircle, ShieldCheck, Sparkles, X } from '@lucide/vue';
import type { DirectoryKind, ProjectRegistrationInput } from '../../../shared/contracts.js';
import { getDesktopApi } from '../services/api.js';

const props = defineProps<{
  defaultStorageRoot: string;
  busy: boolean;
  embedded?: boolean;
}>();

const emit = defineEmits<{
  register: [input: ProjectRegistrationInput];
  cancel: [];
  notify: [message: string, tone: 'error' | 'info'];
}>();

const projectPath = ref('');
const storageRoot = ref(props.defaultStorageRoot);
const autoCheckpoint = ref(true);
const maxBackups = ref(100);
const startOnLaunch = ref(true);
const serenaEnabled = ref(true);
const serenaAutoConfigure = ref(true);

const canRegister = computed(() => (
  projectPath.value.length > 0
  && storageRoot.value.length > 0
  && !props.busy
));

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

function register(): void {
  if (!canRegister.value) return;
  emit('register', {
    projectPath: projectPath.value,
    storageRoot: storageRoot.value,
    autoCheckpoint: autoCheckpoint.value,
    maxBackups: maxBackups.value,
    startOnLaunch: startOnLaunch.value,
    serenaEnabled: serenaEnabled.value,
    serenaAutoConfigure: serenaEnabled.value && serenaAutoConfigure.value
  });
}
</script>

<template>
  <main class="setup-view" :class="{ 'setup-embedded': embedded }">
    <button v-if="embedded" class="drawer-close setup-close" type="button" aria-label="关闭添加工程" @click="emit('cancel')">
      <X :size="16" />
    </button>
    <section class="setup-intro">
      <div class="setup-icon" aria-hidden="true">
        <ShieldCheck :size="26" :stroke-width="1.7" />
      </div>
      <h1>{{ embedded ? '添加保护工程' : '开始保护代码' }}</h1>
      <p>每个工程使用独立备份、自动检查点与 Serena 会话；关闭观察窗口不会停止保护。</p>
    </section>

    <section class="setup-form" aria-labelledby="setup-heading">
      <h2 id="setup-heading">工程与存储</h2>
      <button class="directory-picker" type="button" :disabled="busy" data-testid="choose-project" @click="chooseDirectory('project')">
        <span class="picker-icon"><FolderOpen :size="17" /></span>
        <span class="picker-copy">
          <small>需要保护的工程</small>
          <strong>{{ projectPath || '选择工程目录' }}</strong>
        </span>
        <span class="picker-action">选择</span>
      </button>
      <button class="directory-picker" type="button" :disabled="busy" data-testid="choose-storage" @click="chooseDirectory('storage')">
        <span class="picker-icon"><HardDrive :size="17" /></span>
        <span class="picker-copy">
          <small>外部备份根目录</small>
          <strong>{{ storageRoot }}</strong>
        </span>
        <span class="picker-action">更改</span>
      </button>
      <div class="setup-note">父子工程及工程内备份目录会被拒绝，避免重复监听和递归备份。</div>

      <label class="setting-row">
        <span><strong>自动检查点</strong><small>文件变更后防抖创建可验证快照</small></span>
        <input v-model="autoCheckpoint" class="switch-input" type="checkbox" :disabled="busy" />
        <span class="switch" aria-hidden="true"></span>
      </label>
      <label class="setting-row">
        <span><strong>随应用启动</strong><small>下次启动时恢复此工程的保护会话</small></span>
        <input v-model="startOnLaunch" class="switch-input" type="checkbox" :disabled="busy" />
        <span class="switch" aria-hidden="true"></span>
      </label>
      <label class="setting-row">
        <span><strong>最多保留</strong><small>恢复前安全快照不受此限制</small></span>
        <select v-model.number="maxBackups" :disabled="busy" aria-label="最多保留的普通快照数量">
          <option :value="25">25 个</option>
          <option :value="50">50 个</option>
          <option :value="100">100 个</option>
          <option :value="250">250 个</option>
        </select>
      </label>
    </section>

    <section class="setup-form serena-setup" aria-labelledby="serena-setup-heading">
      <h2 id="serena-setup-heading"><Sparkles :size="12" /> 智能工具会话</h2>
      <label class="setting-row">
        <span><strong>启动 Serena</strong><small>独立 sidecar；失败不影响代码备份</small></span>
        <input v-model="serenaEnabled" class="switch-input" type="checkbox" :disabled="busy" />
        <span class="switch" aria-hidden="true"></span>
      </label>
      <label class="setting-row" :class="{ disabled: !serenaEnabled }">
        <span><strong>自动配置与修复</strong><small>缺失时创建；损坏时先保留原配置</small></span>
        <input v-model="serenaAutoConfigure" class="switch-input" type="checkbox" :disabled="busy || !serenaEnabled" />
        <span class="switch" aria-hidden="true"></span>
      </label>
    </section>

    <button class="button button-primary setup-submit" type="button" :disabled="!canRegister" data-testid="activate-button" @click="register">
      <LoaderCircle v-if="busy" class="spin" :size="16" />
      <ShieldCheck v-else :size="16" />
      {{ busy ? '正在建立独立会话…' : '注册并启动保护' }}
    </button>
  </main>
</template>
