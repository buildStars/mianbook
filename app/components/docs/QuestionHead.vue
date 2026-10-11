<script setup lang="ts">
import type { QuestionDetail } from '#shared/types/handbook'

const props = defineProps<{ question: QuestionDetail }>()
const emit = defineEmits<{ interview: [] }>()

const quiz = useQuizMode()
const { records, toggleStar } = useStudy()
const { firstPathOf, outline } = useOutline()

const starred = computed(() => !!records.value[props.question.id]?.starred)

const level = computed(() => DIFFICULTY_LABELS[props.question.difficulty] ?? '')

/** 按每分钟约 450 字估算阅读时间（代码按字符数算，略偏保守） */
const minutes = computed(() => Math.max(1, Math.round(props.question.html.replace(/<[^>]+>/g, '').length / 450)))

const partLink = computed(() => {
  const part = outline.value.find((p) => p.slug === props.question.part.slug)
  return part ? firstPathOf(part) : '/'
})
const categoryLink = computed(() => {
  const part = outline.value.find((p) => p.slug === props.question.part.slug)
  return part?.categories.find((c) => c.slug === props.question.category.slug)?.questions[0]?.path ?? partLink.value
})
</script>

<template>
  <header class="head">
    <div class="kicker">
      <span class="no serif">No.{{ String(question.num).padStart(2, '0') }}</span>
      <nav class="crumbs" aria-label="所在分类">
        <NuxtLink :to="partLink">{{ question.part.title }}</NuxtLink>
        <span aria-hidden="true">/</span>
        <NuxtLink :to="categoryLink">{{ question.category.title }}</NuxtLink>
      </nav>
    </div>

    <h1 class="title serif"><RichTitle :title="question.title" /></h1>

    <div class="meta">
      <span class="level" :class="`lv-${question.difficulty}`" :title="`难度：${level}`">
        <span class="bars" aria-hidden="true"><i /><i /><i /></span>{{ level }}
      </span>
      <span v-for="t in question.tags" :key="t" class="tag">{{ t }}</span>
      <span class="read">约 {{ minutes }} 分钟读完</span>
    </div>

    <div class="toolbar">
      <button type="button" class="btn btn-ai btn-sm" @click="emit('interview')">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>
        AI 模拟面试
      </button>
      <button
        type="button"
        role="switch"
        class="switch"
        :aria-checked="quiz"
        title="开启后先隐藏答案，自己想好再展开"
        @click="quiz = !quiz"
      >
        <span class="switch-track" />自测模式
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm star-btn"
        :class="{ on: starred }"
        :aria-pressed="starred"
        @click="toggleStar(question.id)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" :fill="starred ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>
        {{ starred ? '已收藏' : '收藏' }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.head {
  margin-bottom: 32px;
}

.kicker {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 14px;
}

.no {
  font-size: 17px;
  font-weight: 700;
  color: var(--c-brand);
}

.crumbs {
  display: flex;
  gap: 8px;
  font-size: 13px;
  color: var(--c-text-3);
}

.crumbs a {
  color: var(--c-text-2);
  transition: color var(--dur);
}

.crumbs a:hover {
  color: var(--c-brand);
}

.title {
  margin: 10px 0 0;
  font-size: 34px;
  font-weight: 800;
  line-height: 1.32;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--c-text-3);
}

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

.read {
  margin-left: 4px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 18px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--c-divider);
}

.star-btn {
  margin-left: auto;
}

.star-btn.on {
  color: var(--st-fuzzy-text);
}

.star-btn.on svg {
  color: var(--st-fuzzy);
}

@media (max-width: 640px) {
  .title {
    font-size: 26px;
  }
}
</style>
