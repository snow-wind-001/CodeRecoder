<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import type { BackupFilterOptions, BackupScope } from '../../../shared/contracts.js';
import { normalizeBackupFilter } from '../../../../src/backupFilter.js';

const props = defineProps<{ modelValue: BackupFilterOptions; disabled?: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: BackupFilterOptions];
  'update:valid': [value: boolean];
}>();
const id = useId();
const scope = ref<BackupScope>(props.modelValue.backupScope ?? 'all');
const pathsText = ref((props.modelValue.excludePaths ?? []).join('\n'));
const extensionsText = ref((props.modelValue.includeExtensions ?? []).join(', '));
const filter = computed<BackupFilterOptions>(() => ({
  backupScope: scope.value,
  excludePaths: pathsText.value.split('\n').map(value => value.trim()).filter(Boolean),
  includeExtensions: extensionsText.value.split(/[,，\s]+/).filter(Boolean)
}));
const valid = computed(() => {
  try { normalizeBackupFilter(filter.value); return true; } catch { return false; }
});
watch(filter, value => {
  emit('update:modelValue', value);
  emit('update:valid', valid.value);
}, { immediate: true });

function addGeneratedDirectories(): void {
  pathsText.value = [...new Set([
    ...filter.value.excludePaths ?? [], 'output/', 'results_swarm_rescue/', 'checkpoints/'
  ])].join('\n');
}
</script>

<template>
  <fieldset class="backup-filter-fields" :disabled="disabled">
    <legend>备份内容</legend>
    <label :for="`${id}-scope`">备份范围</label>
    <select :id="`${id}-scope`" v-model="scope" data-testid="backup-scope">
      <option value="all">全部文件（保留现有排除规则）</option>
      <option value="code-and-docs">仅代码与文档</option>
    </select>
    <p v-if="scope === 'code-and-docs'" class="filter-help">
      按文件名与扩展名保留源码、配置和文档，跳过常见模型、数据、压缩包和媒体文件。
      生成目录内的 JSON、TXT 和代码仍会备份，可在下方排除整个目录。
    </p>
    <p v-else class="filter-help">保留现有行为，仍跳过依赖、构建缓存、日志和 .env 文件。</p>
    <label :for="`${id}-paths`">排除文件或目录</label>
    <textarea :id="`${id}-paths`" v-model="pathsText" rows="4" data-testid="backup-exclude-paths"
      :aria-describedby="`${id}-paths-help`" spellcheck="false" placeholder="output/&#10;results_swarm_rescue/&#10;UsedCode/Models/" />
    <p :id="`${id}-paths-help`" class="filter-help">每行一个相对于工程根目录的路径，目录内所有文件都会排除。支持具体路径，不使用 * 通配符或 ..。</p>
    <button class="filter-preset" type="button" @click="addGeneratedDirectories">添加常见生成目录</button>
    <template v-if="scope === 'code-and-docs'">
      <label :for="`${id}-extensions`">额外保留的扩展名</label>
      <input :id="`${id}-extensions`" v-model="extensionsText" type="text" data-testid="backup-include-extensions"
        :aria-describedby="`${id}-extensions-help`" placeholder="svg, png, csv" spellcheck="false" />
      <p :id="`${id}-extensions-help`" class="filter-help">用逗号分隔，可补充文档插图或特殊源码格式；排除路径仍优先。</p>
    </template>
    <p v-if="!valid" class="filter-error" role="alert">请检查路径和扩展名格式；每项最多 100 条，路径不能越出工程目录。</p>
  </fieldset>
</template>
