<script setup lang="ts">
import { computed } from 'vue';
import { Plus, Sparkles } from '@lucide/vue';
import type { ProjectSummary } from '../../../shared/contracts.js';
import { formatRelative } from '../services/format.js';

const props = defineProps<{
  projects: ProjectSummary[];
  selectedId: string | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  select: [projectId: string];
  add: [];
}>();

const protectedCount = computed(() => props.projects.filter(project => (
  project.protectionState === 'running' || project.protectionState === 'degraded'
)).length);

function stateLabel(project: ProjectSummary): string {
  if (project.protectionState === 'starting') return '启动中';
  if (project.protectionState === 'stopped') return '已停止';
  if (project.protectionState === 'degraded') return '需处理';
  if (project.hasUncheckpointedChanges) return '有新变更';
  return project.latestSnapshotAt ? formatRelative(project.latestSnapshotAt) : '运行中';
}
</script>

<template>
  <section class="project-portfolio" aria-labelledby="portfolio-title">
    <header>
      <div>
        <span class="eyebrow">工程会话</span>
        <strong id="portfolio-title">{{ protectedCount }} / {{ projects.length }} 正在保护</strong>
      </div>
      <button type="button" :disabled="busy" @click="emit('add')"><Plus :size="13" /> 添加</button>
    </header>
    <div class="project-rail" role="group" aria-label="已注册工程">
      <button
        v-for="project in projects"
        :key="project.id"
        class="project-chip"
        :class="[{ selected: selectedId === project.id }, `state-${project.protectionState}`]"
        type="button"
        :aria-pressed="selectedId === project.id"
        :disabled="busy"
        @click="emit('select', project.id)"
      >
        <span class="project-chip-top">
          <i aria-hidden="true"></i>
          <b>{{ project.name }}</b>
          <Sparkles v-if="project.serena.state === 'ready'" :size="11" aria-label="Serena 已就绪" />
        </span>
        <small>{{ stateLabel(project) }}</small>
      </button>
    </div>
  </section>
</template>
