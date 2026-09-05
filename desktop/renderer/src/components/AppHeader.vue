<script setup lang="ts">
import { Layers3, LoaderCircle, Plus, RefreshCw, SlidersHorizontal } from '@lucide/vue';

defineProps<{
  busy: boolean;
  canAdd: boolean;
}>();

defineEmits<{
  refresh: [];
  add: [];
  settings: [];
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
    <div class="topbar-actions">
      <button v-if="canAdd" class="icon-button" type="button" :disabled="busy" aria-label="添加工程" @click="$emit('add')">
        <Plus :size="15" />
      </button>
      <button class="icon-button" type="button" aria-label="MCP 连接设置" data-testid="settings-button" @click="$emit('settings')">
        <SlidersHorizontal :size="15" />
      </button>
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
    </div>
  </header>
</template>
