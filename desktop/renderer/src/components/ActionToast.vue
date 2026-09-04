<script setup lang="ts">
import { AlertTriangle, CircleCheck, Info, X } from '@lucide/vue';

defineProps<{
  message: string;
  tone: 'success' | 'error' | 'info';
}>();

defineEmits<{
  close: [];
}>();
</script>

<template>
  <div
    class="toast"
    :class="`tone-${tone}`"
    :role="tone === 'error' ? 'alert' : 'status'"
    :aria-live="tone === 'error' ? 'assertive' : 'polite'"
    data-testid="toast"
  >
    <CircleCheck v-if="tone === 'success'" :size="16" />
    <AlertTriangle v-else-if="tone === 'error'" :size="16" />
    <Info v-else :size="16" />
    <span>{{ message }}</span>
    <button type="button" aria-label="关闭通知" @click="$emit('close')">
      <X :size="14" />
    </button>
  </div>
</template>
