<script setup lang="ts">
import { computed } from 'vue';
import { DatabaseBackup, LoaderCircle } from '@lucide/vue';
import type { DesktopDashboard } from '../../../shared/contracts.js';
import { formatRelative } from '../services/format.js';

const props = defineProps<{
  dashboard: DesktopDashboard;
  busy: boolean;
}>();

defineEmits<{
  backup: [];
}>();

const automatic = computed(() => props.dashboard.automaticCheckpoint);
const status = computed(() => props.dashboard.status);
const latestAt = computed(() => status.value?.latestSnapshot?.createdAt ?? automatic.value.lastCheckpointAt);

const presentation = computed(() => {
  if (automatic.value.state === 'degraded') {
    return {
      tone: 'danger',
      statusLine: '自动检查点需要处理',
      title: '保护已降级',
      detail: automatic.value.lastError ?? '请检查文件监听器状态'
    };
  }
  if (automatic.value.state === 'paused' || automatic.value.backupInProgress) {
    return {
      tone: 'busy',
      statusLine: '备份操作正在进行',
      title: '正在保护',
      detail: '完成后将自动刷新完整性状态'
    };
  }
  if (status.value?.hasUncheckpointedChanges) {
    return {
      tone: 'warning',
      statusLine: automatic.value.state === 'running' ? '变更正在等待检查点' : '发现尚未备份的代码',
      title: '存在新变更',
      detail: '可立即创建备份，或等待自动检查点完成'
    };
  }
  if (automatic.value.state === 'stopped') {
    return {
      tone: 'manual',
      statusLine: '当前使用手动备份模式',
      title: '保护可用',
      detail: latestAt.value ? `最近备份于 ${formatRelative(latestAt.value)}完成并通过校验` : '尚未创建备份'
    };
  }
  return {
    tone: 'healthy',
    statusLine: '自动检查点正在运行',
    title: '保护正常',
    detail: latestAt.value ? `最近备份于 ${formatRelative(latestAt.value)}完成并通过校验` : '等待首个自动检查点'
  };
});
</script>

<template>
  <section class="protection-card" :class="`tone-${presentation.tone}`" aria-labelledby="protection-title">
    <div class="protection-decoration" aria-hidden="true"></div>
    <div class="protection-status">
      <i></i>
      {{ presentation.statusLine }}
    </div>
    <h1 id="protection-title">{{ presentation.title }}</h1>
    <p>{{ presentation.detail }}</p>
    <button
      class="protection-action"
      type="button"
      :disabled="busy"
      data-testid="create-backup-button"
      @click="$emit('backup')"
    >
      <LoaderCircle v-if="busy" class="spin" :size="16" />
      <DatabaseBackup v-else :size="16" />
      {{ busy ? '正在处理…' : '立即创建备份' }}
    </button>
    <div class="health-grid">
      <div>
        <span>当前代码</span>
        <b>{{ status?.hasUncheckpointedChanges ? '有待备份变更' : '已完整备份' }}</b>
      </div>
      <div>
        <span>备份位置</span>
        <b>{{ status?.externalStorage ? '外部存储' : '工程内存储' }}</b>
      </div>
    </div>
  </section>
</template>
