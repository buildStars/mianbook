<script setup lang="ts">
/** 难度标记：三格信号条 + 基础 / 进阶 / 深入（题目页和分类专题页共用） */
const props = defineProps<{ value: number }>()
const label = computed(() => DIFFICULTY_LABELS[props.value] ?? '')
</script>

<template>
  <span class="level" :class="`lv-${value}`" :title="`难度：${label}`">
    <span class="bars" aria-hidden="true"><i /><i /><i /></span>{{ label }}
  </span>
</template>

<style scoped>
.level {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px 0 8px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-sm);
  background: var(--c-bg-elv);
  color: var(--c-text-2);
  font-size: 12px;
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
