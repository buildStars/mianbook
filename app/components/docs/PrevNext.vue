<script setup lang="ts">
import type { QuestionLink } from '#shared/types/handbook'

defineProps<{ prev: QuestionLink | null; next: QuestionLink | null }>()
</script>

<template>
  <nav v-if="prev || next" class="pager" aria-label="上一题和下一题">
    <NuxtLink v-if="prev" :to="prev.path" class="pager-link prev">
      <span class="desc">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
        上一题
      </span>
      <span class="title">{{ plainTitle(prev.title) }}</span>
    </NuxtLink>
    <span v-else />
    <NuxtLink v-if="next" :to="next.path" class="pager-link next">
      <span class="desc">
        下一题
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </span>
      <span class="title">{{ plainTitle(next.title) }}</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.pager {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 48px;
}

.pager-link {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 20px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  transition:
    border-color var(--dur),
    box-shadow var(--dur),
    transform var(--dur) var(--ease);
}

.pager-link:hover {
  border-color: var(--c-border);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.next {
  align-items: flex-end;
  text-align: right;
}

.desc {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--c-text-3);
}

.title {
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.5;
  color: var(--c-text-1);
}

.pager-link:hover .title {
  color: var(--c-brand);
}

@media (max-width: 640px) {
  .pager {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
