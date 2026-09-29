<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { LoaderCircle, X } from '@lucide/vue';
import type { BackupFilterOptions } from '../../../shared/contracts.js';
import { normalizeBackupFilter } from '../../../../src/backupFilter.js';
import { getDesktopApi } from '../services/api.js';
import BackupFilterFields from './BackupFilterFields.vue';

const props = defineProps<{ projectId: string; projectName: string; filter: BackupFilterOptions }>();
const emit = defineEmits<{
  close: [];
  saved: [filter: BackupFilterOptions];
  notify: [message: string, tone: 'success' | 'error'];
}>();
const filter = ref<BackupFilterOptions>(normalizeBackupFilter(props.filter));
const valid = ref(true);
const saving = ref(false);
const drawer = ref<HTMLElement | null>(null);
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
onMounted(async () => {
  await nextTick();
  drawer.value?.querySelector<HTMLButtonElement>('button')?.focus();
});
onBeforeUnmount(() => { void nextTick(() => previousFocus?.focus()); });

async function save(): Promise<void> {
  if (!valid.value || saving.value) return;
  saving.value = true;
  try {
    const normalized = normalizeBackupFilter(filter.value);
    const response = await getDesktopApi().updateBackupFilter({ projectId: props.projectId, filter: normalized });
    if (!response.success) throw new Error(response.error ?? response.message);
    emit('saved', normalized);
    emit('notify', response.message, 'success');
    emit('close');
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : String(error), 'error');
  } finally {
    saving.value = false;
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !saving.value) { event.preventDefault(); emit('close'); }
  if (event.key !== 'Tab' || !drawer.value) return;
  const controls = [...drawer.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
</script>

<template>
  <Teleport to="body">
    <div class="settings-overlay" @mousedown.self="!saving && emit('close')">
      <aside ref="drawer" class="settings-drawer backup-settings-drawer" role="dialog" aria-modal="true" aria-labelledby="backup-settings-title" @keydown="handleKeydown">
        <header class="settings-heading">
          <div><h2 id="backup-settings-title">备份范围</h2><p>{{ projectName }}</p></div>
          <button class="drawer-close" type="button" :disabled="saving" aria-label="关闭备份范围" @click="emit('close')"><X :size="16" /></button>
        </header>
        <form @submit.prevent="save">
          <BackupFilterFields v-model="filter" v-model:valid="valid" :disabled="saving" />
          <p class="filter-help filter-activation-note">保存后在下次启动工程保护时生效。当前会话继续使用原范围，现有快照保留。</p>
          <button class="button button-primary" type="submit" :disabled="saving || !valid" data-testid="save-backup-filter">
            <LoaderCircle v-if="saving" class="spin" :size="16" />{{ saving ? '正在保存…' : '保存备份范围' }}
          </button>
        </form>
      </aside>
    </div>
  </Teleport>
</template>
