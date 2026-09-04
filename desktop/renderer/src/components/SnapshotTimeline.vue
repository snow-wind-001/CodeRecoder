<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  ChevronDown,
  FileCheck2,
  LoaderCircle,
  RotateCcw
} from '@lucide/vue';
import type { SnapshotSummary } from '../../../shared/contracts.js';
import {
  formatBytes,
  formatDate,
  shortHash,
  triggerLabel
} from '../services/format.js';

const props = defineProps<{
  snapshots: SnapshotSummary[];
  totalCount: number;
  busy: boolean;
  verifyingId: string | null;
}>();

const emit = defineEmits<{
  verify: [snapshot: SnapshotSummary];
  restore: [snapshot: SnapshotSummary];
}>();

const selectedId = ref<string | null>(props.snapshots[0]?.id ?? null);

watch(
  () => props.snapshots.map(snapshot => snapshot.id).join(','),
  () => {
    if (!props.snapshots.some(snapshot => snapshot.id === selectedId.value)) {
      selectedId.value = props.snapshots[0]?.id ?? null;
    }
  }
);

const totalLabel = computed(() => {
  if (props.totalCount <= props.snapshots.length) return `共 ${props.totalCount} 个`;
  return `最近 ${props.snapshots.length} / 共 ${props.totalCount} 个`;
});

function toggle(snapshotId: string): void {
  selectedId.value = selectedId.value === snapshotId ? null : snapshotId;
}

function totalChanges(snapshot: SnapshotSummary): number {
  return snapshot.changeCounts.added
    + snapshot.changeCounts.modified
    + snapshot.changeCounts.deleted
    + snapshot.changeCounts.renamed;
}
</script>

<template>
  <section class="snapshot-section" aria-labelledby="snapshot-heading">
    <div class="section-heading">
      <h2 id="snapshot-heading">快照时间线</h2>
      <span>{{ totalLabel }}</span>
    </div>

    <div v-if="snapshots.length === 0" class="empty-state">
      <FileCheck2 :size="24" :stroke-width="1.5" />
      <strong>还没有备份</strong>
      <span>创建第一个快照后，详细证据会显示在这里。</span>
    </div>

    <div v-else class="timeline" data-testid="snapshot-list">
      <article
        v-for="snapshot in snapshots"
        :key="snapshot.id"
        class="snapshot-row"
        :class="{ selected: selectedId === snapshot.id }"
      >
        <span class="timeline-dot" aria-hidden="true"></span>
        <button
          class="snapshot-toggle"
          type="button"
          :aria-expanded="selectedId === snapshot.id"
          :aria-controls="`snapshot-${snapshot.id}`"
          @click="toggle(snapshot.id)"
        >
          <span class="snapshot-title">
            <strong>{{ triggerLabel(snapshot.trigger) }}</strong>
            <small v-if="snapshot.name && snapshot.name !== triggerLabel(snapshot.trigger)">{{ snapshot.name }}</small>
          </span>
          <span class="snapshot-time">
            <time>{{ formatDate(snapshot.createdAt) }}</time>
            <ChevronDown :size="14" aria-hidden="true" />
          </span>
          <span class="snapshot-evidence" :title="`完整树哈希：${snapshot.treeHash}`">
            SHA-256 · {{ shortHash(snapshot.treeHash) }} · {{ snapshot.totalFiles }} 个文件
          </span>
        </button>

        <div
          v-if="selectedId === snapshot.id"
          :id="`snapshot-${snapshot.id}`"
          class="snapshot-detail"
        >
          <div class="detail-grid">
            <div>
              <span>变更</span>
              <b>{{ totalChanges(snapshot) }} 项</b>
            </div>
            <div>
              <span>逻辑大小</span>
              <b>{{ formatBytes(snapshot.logicalBytes) }}</b>
            </div>
            <div>
              <span>新增占用</span>
              <b>{{ formatBytes(snapshot.storedBytes) }}</b>
            </div>
          </div>
          <div class="change-line" aria-label="快照变更统计">
            <span class="added">+{{ snapshot.changeCounts.added }} 新增</span>
            <span>~{{ snapshot.changeCounts.modified }} 修改</span>
            <span class="deleted">−{{ snapshot.changeCounts.deleted }} 删除</span>
            <span>↗{{ snapshot.changeCounts.renamed }} 重命名</span>
          </div>
          <div class="snapshot-actions">
            <button
              class="button button-secondary"
              type="button"
              :disabled="busy"
              :data-testid="`verify-${snapshot.id}`"
              @click="emit('verify', snapshot)"
            >
              <LoaderCircle v-if="verifyingId === snapshot.id" class="spin" :size="14" />
              <FileCheck2 v-else :size="14" />
              验证完整性
            </button>
            <button
              class="button button-primary"
              type="button"
              :disabled="busy"
              :data-testid="`restore-${snapshot.id}`"
              @click="emit('restore', snapshot)"
            >
              <RotateCcw :size="14" />
              预览并恢复
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
