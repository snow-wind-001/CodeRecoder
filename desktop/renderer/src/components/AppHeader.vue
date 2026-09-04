<script setup lang="ts">
import { Layers3, LoaderCircle, RefreshCw } from '@lucide/vue';

defineProps<{
  busy: boolean;
}>();

defineEmits<{
  refresh: [];
}>();
</script>

<template>
  <header class="topbar">
    <div class="brand-lockup">
      <div class="brand-mark" aria-hidden="true">
        <Layers3 :size="18" :stroke-width="1.8" />
      </div>
      <div>
        <strong>CodeRecoder</strong>
        <small>本地代码保护</small>
      </div>
    </div>
    <button
      class="icon-button"
      type="button"
      :disabled="busy"
      aria-label="刷新备份状态"
      data-testid="refresh-button"
      @click="$emit('refresh')"
    >
      <LoaderCircle v-if="busy" class="spin" :size="15" />
      <RefreshCw v-else :size="15" />
    </button>
  </header>
</template>
