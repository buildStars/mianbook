<script setup lang="ts">
import type { PracticeSummary } from '#shared/types/practice'

/** 默写练习列表：按分类列出全部练习，标出这台设备上通过过的、写到一半的 */
const { data } = await useFetch<PracticeSummary[]>('/api/practice', { key: 'practice-list', default: () => [] })
const list = computed(() => data.value ?? [])

const description = computed(
  () => `${list.value.length} 道高频手写题的默写练习：只给要求和函数签名，在浏览器里自己写实现、跑测试用例检验，通过后看参考答案，还能让 AI 面试官点评代码。`,
)
useSeoMeta({ title: '默写练习', description, ogTitle: '默写练习 · 手写题在线练习', ogDescription: description })

const progress = usePracticeProgress()
const mounted = ref(false)
onMounted(() => {
  progress.load()
  mounted.value = true
})

type State = 'passed' | 'draft' | 'new'
const stateOf = (q: PracticeSummary): State => {
  if (!mounted.value) return 'new'
  if (progress.passed.value[q.questionId]) return 'passed'
  return progress.readDraft(q.questionId) !== null ? 'draft' : 'new'
}
const STATE_LABELS: Record<State, string> = { passed: '通过过', draft: '写到一半', new: '' }

const groups = computed(() => {
  const map = new Map<string, { slug: string; title: string; path: string; items: PracticeSummary[] }>()
  for (const q of list.value) {
    let g = map.get(q.category.slug)
    if (!g) {
      g = { slug: q.category.slug, title: q.category.title, path: `/${q.path.split('/')[1]}/${q.category.slug}`, items: [] }
      map.set(q.category.slug, g)
    }
    g.items.push(q)
  }
  return [...map.values()]
})
const passedCount = computed(() => list.value.filter((q) => stateOf(q) === 'passed').length)
/** 从第一道没通过的开始 */
const next = computed(() => list.value.find((q) => stateOf(q) !== 'passed') ?? list.value[0])

const steps = [
  { title: '看要求', text: '只有行为说明和函数签名，参考答案先藏起来' },
  { title: '写代码、跑测试', text: '在浏览器里写实现，用测试用例检验边界情况' },
  { title: '对答案、听点评', text: '通过后对照参考答案；登录后让 AI 面试官挑问题' },
]
</script>

<template>
  <div class="page container">
    <header class="page-head">
      <p class="eyebrow">练习</p>
      <h1 class="serif">默写练习</h1>
      <p class="sub">面试里的手写题，光看懂不够，要能在白板上一次写对。这里只给要求和函数签名，你自己写完点运行，用测试用例检验对不对。</p>
      <div class="actions">
        <NuxtLink v-if="next" :to="`/practice${next.path}`" class="btn btn-primary">
          {{ passedCount ? `接着练：${next.title}` : `从第一道开始：${next.title}` }}
        </NuxtLink>
        <ClientOnly>
          <span class="count">已通过 <b class="num">{{ passedCount }}</b> / {{ list.length }} 道</span>
        </ClientOnly>
      </div>
    </header>

    <ol class="steps">
      <li v-for="(s, i) in steps" :key="s.title">
        <span class="step-no num">{{ i + 1 }}</span>
        <span class="step-title">{{ s.title }}</span>
        <span class="step-text">{{ s.text }}</span>
      </li>
    </ol>

    <section v-for="g in groups" :key="g.slug" class="group">
      <h2 class="group-head">
        <NuxtLink :to="g.path" class="serif">{{ g.title }}</NuxtLink>
        <span class="group-count num">{{ g.items.length }} 道</span>
      </h2>
      <ol class="items">
        <li v-for="q in g.items" :key="q.path">
          <NuxtLink :to="`/practice${q.path}`" class="item" :class="stateOf(q)">
            <span class="item-no num">{{ String(q.num).padStart(2, '0') }}</span>
            <span class="item-main">
              <span class="item-title">{{ q.title }}</span>
              <span class="item-sub">{{ plainTitle(q.questionTitle) }}</span>
            </span>
            <DifficultyBadge :value="q.difficulty" class="item-level" />
            <span class="item-state" :class="stateOf(q)">{{ STATE_LABELS[stateOf(q)] }}</span>
          </NuxtLink>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 900px;
  padding-top: 40px;
  padding-bottom: 80px;
}

.page-head h1 {
  margin: 10px 0 0;
  font-size: clamp(32px, 4.4vw, 46px);
  font-weight: 800;
  line-height: 1.2;
}

.sub {
  max-width: 640px;
  margin: 14px 0 0;
  font-size: 16px;
  line-height: 1.8;
  color: var(--c-text-2);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
  margin-top: 24px;
}

.count {
  font-size: 14px;
  color: var(--c-text-2);
}

.count b {
  font-size: 18px;
  color: var(--st-mastered-text);
}

.steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 36px 0 0;
  padding: 0;
  list-style: none;
}

.steps li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  padding: 14px 16px;
  border-radius: var(--r-lg);
  background: var(--c-bg-soft);
}

.step-no {
  grid-row: span 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--c-bg-elv);
  font-size: 13px;
  font-weight: 700;
  color: var(--c-brand);
}

.step-title {
  font-size: 14px;
  font-weight: 700;
}

.step-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.group {
  margin-top: 40px;
}

.group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 12px;
}

.group-head a {
  font-size: 22px;
  font-weight: 700;
  color: var(--c-text-1);
}

.group-head a:hover {
  color: var(--c-brand);
}

.group-count {
  font-size: 13px;
  font-weight: 400;
  color: var(--c-text-3);
}

.items {
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  list-style: none;
}

.items li + li {
  border-top: 1px solid var(--c-divider);
}

.item {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 64px;
  padding: 10px 18px;
  color: var(--c-text-1);
  transition: background-color var(--dur-fast);
}

.item:hover {
  background: var(--c-bg-soft);
}

.item-no {
  flex: none;
  width: 26px;
  font-size: 13px;
  color: var(--c-brand);
}

.item-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.item-title {
  font-size: 15px;
  font-weight: 600;
}

.item-sub {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-3);
}

.item-level {
  flex: none;
}

.item-state {
  flex: none;
  min-width: 56px;
  font-size: 12px;
  font-weight: 600;
  text-align: right;
}

.item-state.passed {
  color: var(--st-mastered-text);
}

.item-state.draft {
  color: var(--st-fuzzy-text);
}

@media (max-width: 640px) {
  .steps {
    grid-template-columns: minmax(0, 1fr);
  }

  .item {
    gap: 10px;
    padding: 10px 14px;
  }

  .item-level {
    display: none;
  }
}
</style>
