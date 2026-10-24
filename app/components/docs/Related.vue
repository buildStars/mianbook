<script setup lang="ts">
import type { RelatedQuestion } from '#shared/types/handbook'

/** 题目页底部"接着看"：服务端按内容相似度挑的相关题目，外加去分类专题页的入口 */
const props = defineProps<{
  related: RelatedQuestion[]
  categoryPath: string
  categoryTitle: string
}>()

// "全部 JavaScript 面试题" / "全部浏览器面试题"
const allLabel = computed(() => {
  const h = categoryHeading(props.categoryTitle)
  return `全部${/^[\x21-\x7e]/.test(h) ? ' ' : ''}${h}`
})
</script>

<template>
  <section class="related" aria-labelledby="related-title">
    <div class="head">
      <h2 id="related-title" class="serif">相关题目</h2>
      <NuxtLink :to="categoryPath" class="all tap">{{ allLabel }} →</NuxtLink>
    </div>
    <ul v-if="related.length" class="list">
      <li v-for="q in related" :key="q.id">
        <NuxtLink :to="q.path" class="item">
          <span class="item-title"><RichTitle :title="q.title" /></span>
          <span class="item-cat">{{ q.category }} · {{ DIFFICULTY_LABELS[q.difficulty] }}</span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.related {
  margin-top: 56px;
  padding-top: 32px;
  border-top: 1px solid var(--c-divider);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
}

.head h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.all {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-brand);
}

.list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  padding: 14px 16px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}

.item:hover {
  border-color: var(--c-border);
  box-shadow: var(--shadow-xs);
}

.item-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.55;
}

.item-cat {
  font-size: 12px;
  color: var(--c-text-3);
}

@media (max-width: 640px) {
  .list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
