<script setup lang="ts">
/** 题目状态：已发布是实心绿点，草稿是空心圆点 */
defineProps<{ status: 'draft' | 'published' }>()
</script>

<template>
  <span class="a-status" :class="status">
    <i aria-hidden="true" />{{ status === 'published' ? '已发布' : '草稿' }}
  </span>
</template>

<style scoped>
.a-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 9px 0 8px;
  border-radius: var(--r-full);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.published {
  background: var(--c-success-soft);
  color: var(--c-success);
}

.published i {
  background: var(--st-mastered);
}

.draft {
  border: 1px dashed var(--c-border);
  color: var(--c-text-2);
}

.draft i {
  border: 1.5px solid var(--c-text-3);
}
</style>
