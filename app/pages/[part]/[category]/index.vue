<script setup lang="ts">
import type { CategoryDetail } from '#shared/types/handbook'

/**
 * 分类专题页：/basics/javascript 这样的地址。列出分类下全部题目和一句话回答，
 * 是"JavaScript 面试题"这类搜索词的落地页，也是首页目录和题目页面包屑的去处
 */
const route = useRoute()
const key = computed(() => `${route.params.part}/${route.params.category}`)
const { data } = await useFetch<CategoryDetail>(() => `/api/categories/${key.value}`, { key: computed(() => `category:${key.value}`) })
if (!data.value) throw createError({ statusCode: 404, statusMessage: '这个分类不存在', fatal: true })

const { siteUrl, siteName } = useRuntimeConfig().public
const { records } = useStudy()

const d = computed(() => data.value!)
const heading = computed(() => categoryHeading(d.value.category.title))
const total = computed(() => d.value.questions.length)
// "25 道 JavaScript 面试题" / "20 道浏览器面试题"：英文开头时数字后空一格
const countHeading = computed(() => `${total.value} 道${/^[\x21-\x7e]/.test(heading.value) ? ' ' : ''}${heading.value}`)

const description = computed(() => {
  const sample = d.value.questions
    .slice(0, 4)
    .map((q) => plainTitle(q.title).replace(/[？?]$/, ''))
    .join('、')
  return `${countHeading.value}：${sample}……每道题都有一句话回答、详细解析、面试官追问和易错点，读完还能让 AI 面试官考你。`
})

useSeoMeta({
  title: () => `${heading.value}（${total.value} 道）`,
  description,
  ogTitle: () => `${heading.value}（${total.value} 道）`,
  ogDescription: description,
})

// 结构化数据：面包屑和题目列表，帮助搜索引擎理解这是一个题目合集
useJsonLd(() => [
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: siteName, item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: heading.value, item: `${siteUrl}/${key.value}` },
    ],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: heading.value,
    numberOfItems: total.value,
    itemListElement: d.value.questions.map((q, i) => ({ '@type': 'ListItem', position: i + 1, url: siteUrl + q.path, name: plainTitle(q.title) })),
  },
])

// 难度筛选：0 是全部
const level = ref(0)
const levels = computed(() =>
  [1, 2, 3].map((v) => ({ value: v, label: DIFFICULTY_LABELS[v]!, count: d.value.questions.filter((q) => q.difficulty === v).length })).filter((l) => l.count),
)
const shown = computed(() => (level.value ? d.value.questions.filter((q) => q.difficulty === level.value) : d.value.questions))

const statusOf = (id: number) => records.value[id]?.status ?? null
const mastered = computed(() => d.value.questions.filter((q) => statusOf(q.id) === 'mastered').length)
/** 学过的人从第一道没掌握的题接着来，没学过从第 1 题开始 */
const next = computed(() => (mastered.value ? d.value.questions.find((q) => statusOf(q.id) !== 'mastered') : null) ?? d.value.questions[0])
</script>

<template>
  <div class="page container">
    <nav class="crumbs" aria-label="面包屑">
      <NuxtLink to="/" class="tap">首页</NuxtLink>
      <span aria-hidden="true">/</span>
      <span>{{ d.part.title }}</span>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{{ d.category.title }}</span>
    </nav>

    <header class="page-head">
      <p class="eyebrow">{{ d.part.title }} · 分类</p>
      <h1 class="serif">{{ heading }}</h1>
      <p class="sub">
        共 {{ total }} 道，按由浅入深的顺序排列。每道题都有一句话回答、详细解析、面试官可能追问和易错点；读完可以让 AI 面试官只考这一类。
      </p>
      <p class="facts">
        <span v-for="l in levels" :key="l.value">{{ l.label }} {{ l.count }} 道</span>
        <span v-if="mastered" class="facts-done">你已掌握 {{ mastered }} / {{ total }}</span>
      </p>
      <div class="actions">
        <NuxtLink v-if="next" :to="next.path" class="btn btn-primary">
          {{ mastered ? `接着学：No.${String(next.num).padStart(2, '0')}` : '从第 1 题开始' }}
        </NuxtLink>
        <NuxtLink :to="`/mock?categories=${d.category.id}`" class="btn btn-ai">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>
          只考这一类的模拟面试
        </NuxtLink>
      </div>
    </header>

    <div v-if="levels.length > 1" class="filter" role="group" aria-label="按难度筛选">
      <button type="button" :aria-pressed="level === 0" @click="level = 0">全部 {{ total }}</button>
      <button v-for="l in levels" :key="l.value" type="button" :aria-pressed="level === l.value" @click="level = l.value">
        {{ l.label }} {{ l.count }}
      </button>
    </div>

    <ol class="q-list">
      <li v-for="q in shown" :key="q.id">
        <NuxtLink :to="q.path" class="q-card">
          <span class="q-no num">{{ String(q.num).padStart(2, '0') }}</span>
          <span class="q-main">
            <span class="q-title serif"><RichTitle :title="q.title" /></span>
            <span class="q-summary">{{ q.summary }}</span>
            <span class="q-meta">
              <DifficultyBadge :value="q.difficulty" />
              <span v-for="t in q.tags" :key="t" class="tag">{{ t }}</span>
            </span>
          </span>
          <span
            class="dot"
            :class="statusOf(q.id) && `is-${statusOf(q.id)}`"
            :aria-label="statusOf(q.id) ? STATUS_LABELS[statusOf(q.id)!] : '未学'"
          />
        </NuxtLink>
      </li>
    </ol>

    <section v-if="d.siblings.length" class="siblings">
      <h2 class="serif">{{ d.part.title }}的其他分类</h2>
      <div class="sibling-list">
        <NuxtLink v-for="s in d.siblings" :key="s.path" :to="s.path" class="sibling">
          {{ s.title }}<span class="num">{{ s.count }}</span>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 900px;
  padding-top: 32px;
  padding-bottom: 80px;
}

.crumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: var(--c-text-3);
}

.crumbs a {
  color: var(--c-text-2);
}

.crumbs a:hover {
  color: var(--c-brand);
}

.page-head {
  margin-top: 24px;
}

.page-head h1 {
  margin: 10px 0 0;
  font-size: clamp(32px, 4.4vw, 46px);
  font-weight: 800;
  line-height: 1.2;
}

.sub {
  max-width: 680px;
  margin: 14px 0 0;
  font-size: 16px;
  line-height: 1.8;
  color: var(--c-text-2);
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin: 12px 0 0;
  font-size: 14px;
  color: var(--c-text-3);
}

.facts-done {
  color: var(--st-mastered-text);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.filter {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 40px;
  padding: 4px;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
}

.filter button {
  min-height: 34px;
  padding: 0 14px;
  border: none;
  border-radius: var(--r-sm);
  background: none;
  font-size: 14px;
  color: var(--c-text-2);
  cursor: pointer;
}

.filter button[aria-pressed='true'] {
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-xs);
  font-weight: 600;
  color: var(--c-text-1);
}

.q-list {
  display: grid;
  gap: 12px;
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
}

.q-card {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 10px;
  gap: 14px;
  padding: 18px 20px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}

.q-card:hover {
  border-color: var(--c-border);
  box-shadow: var(--shadow-sm);
}

.q-no {
  padding-top: 3px;
  font-size: 13px;
  color: var(--c-brand);
}

.q-main {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.q-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
}

.q-summary {
  display: -webkit-box;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.75;
  color: var(--c-text-2);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.q-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.dot {
  margin-top: 9px;
}

.siblings {
  margin-top: 64px;
}

.siblings h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.sibling-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.sibling {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-full);
  background: var(--c-bg-elv);
  font-size: 14px;
  color: var(--c-text-1);
}

.sibling:hover {
  border-color: var(--c-border);
  color: var(--c-brand);
}

.sibling .num {
  font-size: 12px;
  color: var(--c-text-3);
}

@media (max-width: 640px) {
  .q-card {
    grid-template-columns: 30px minmax(0, 1fr) 10px;
    gap: 10px;
    padding: 16px;
  }

  .q-title {
    font-size: 16px;
  }
}

@media (pointer: coarse) {
  .filter button {
    min-height: 44px;
  }
}
</style>
