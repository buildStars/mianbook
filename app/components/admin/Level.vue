<script setup lang="ts">
/** 难度：和前台题目页一样的三格信号条 + 文字 */
const props = withDefaults(defineProps<{ value: number; label?: boolean }>(), { label: true })
const text = computed(() => DIFFICULTY_LABELS[props.value] ?? '')
</script>

<template>
  <span class="a-level" :class="`lv-${value}`" :title="`难度：${text}`">
    <span class="bars" aria-hidden="true"><i /><i /><i /></span>
    <span v-if="label">{{ text }}</span>
    <span v-else class="visually-hidden">{{ text }}</span>
  </span>
</template>

<style scoped>
.a-level {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--c-text-2);
  white-space: nowrap;
}

.bars {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 11px;
}

.bars i {
  width: 3px;
  border-radius: 1px;
  background: var(--c-bg-mute);
}

.bars i:nth-child(1) { height: 5px; }
.bars i:nth-child(2) { height: 8px; }
.bars i:nth-child(3) { height: 11px; }

.lv-1 .bars i:nth-child(-n + 1),
.lv-2 .bars i:nth-child(-n + 2),
.lv-3 .bars i:nth-child(-n + 3) {
  background: var(--c-text-1);
}
</style>
