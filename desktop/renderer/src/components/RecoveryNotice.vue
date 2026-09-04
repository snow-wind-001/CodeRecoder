<script setup lang="ts">
import { computed } from 'vue';
import {
  AlertTriangle,
  CircleCheck,
  Clock3,
  RotateCcw,
  ShieldCheck
} from '@lucide/vue';
import type { RecoveryView } from '../../../shared/contracts.js';
import { formatDate } from '../services/format.js';

const props = defineProps<{
  recovery: RecoveryView;
}>();

const icon = computed(() => {
  if (props.recovery.state === 'rollback-failed') return AlertTriangle;
  if (props.recovery.state === 'rolled-back' || props.recovery.state === 'startup-rollback') return RotateCcw;
  if (props.recovery.state === 'preview-ready') return Clock3;
  if (props.recovery.state === 'restore-rejected') return AlertTriangle;
  if (props.recovery.state === 'restored') return CircleCheck;
  return ShieldCheck;
});

const tone = computed(() => {
  if (props.recovery.state === 'rollback-failed') return 'danger';
  if (props.recovery.state === 'restore-rejected' || props.recovery.state === 'preview-ready') return 'warning';
  if (props.recovery.state === 'rolled-back' || props.recovery.state === 'startup-rollback') return 'rollback';
  return 'safe';
});
</script>

<template>
  <section class="recovery-notice" :class="`tone-${tone}`" aria-live="polite" data-testid="recovery-status">
    <div class="recovery-icon" aria-hidden="true">
      <component :is="icon" :size="15" :stroke-width="2" />
    </div>
    <div>
      <strong>{{ recovery.title }}</strong>
      <span>{{ recovery.detail }}</span>
      <time v-if="recovery.occurredAt">{{ formatDate(recovery.occurredAt) }}</time>
    </div>
  </section>
</template>
