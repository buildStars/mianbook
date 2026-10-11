<script setup lang="ts">
import type { ReviewGrade, ReviewItem } from '#shared/types/handbook'

useHead({ title: '今日复习 | 全栈面试手册' })

const { loggedIn } = useUserSession()
const { summary, refresh } = useReview()
const { records } = useStudy()

const queue = ref<ReviewItem[]>([])
const loading = ref(true)
const index = ref(0)
const revealed = ref(false)
const rating = ref(false)
const errorMsg = ref('')
/** 本次打开页面后复习了几道 */
const doneNow = ref(0)

const GRADES: { grade: ReviewGrade; label: string; hint: string; key: string }[] = [
  { grade: 1, label: '不会', hint: '完全想不起来', key: 'weak' },
  { grade: 2, label: '模糊', hint: '想起一部分', key: 'fuzzy' },
  { grade: 3, label: '会了', hint: '能讲清楚', key: 'good' },
  { grade: 4, label: '很熟', hint: '张口就来', key: 'easy' },
]

const current = computed(() => queue.value[index.value] ?? null)
const total = computed(() => queue.value.length)

async function loadQueue() {
  if (!loggedIn.value) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    queue.value = await $fetch<ReviewItem[]>('/api/review/queue', { query: { tz: new Date().getTimezoneOffset() } })
    index.value = 0
    revealed.value = false
  } catch {
    errorMsg.value = '复习列表加载失败，请刷新重试'
  } finally {
    loading.value = false
  }
}

onMounted(loadQueue)
watch(loggedIn, () => {
  loadQueue()
  refresh()
})

async function rate(grade: ReviewGrade) {
  const item = current.value
  if (!item || rating.value) return
  rating.value = true
  errorMsg.value = ''
  try {
    const res = await $fetch<{ record: { status: 'weak' | 'fuzzy' | 'mastered'; starred: boolean; note: string | null; updatedAt: string } | null }>(
      `/api/review/${item.id}`,
      { method: 'POST', body: { grade } },
    )
    if (res.record) records.value = { ...records.value, [item.id]: res.record }
    doneNow.value++
    index.value++
    revealed.value = false
    refresh()
  } catch {
    errorMsg.value = '保存失败，请检查网络后重试'
  } finally {
    rating.value = false
  }
}

/** 快捷键：空格或回车显示答案，1～4 评分 */
function onKeydown(e: KeyboardEvent) {
  if (!current.value || e.ctrlKey || e.metaKey || e.altKey) return
  if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return
  if (!revealed.value && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault()
    revealed.value = true
  } else if (revealed.value && ['1', '2', '3', '4'].includes(e.key)) {
    rate(Number(e.key) as ReviewGrade)
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const intervalText = (days: number) => (days <= 1 ? '明天' : days < 30 ? `${days} 天后` : days < 365 ? `${Math.round(days / 30)} 个月后` : '一年后')

const forecastMax = computed(() => Math.max(1, ...(summary.value?.forecast.map((f) => f.count) ?? [1])))
const weekday = (date: string, i: number) => (i === 0 ? '今天' : i === 1 ? '明天' : `周${'日一二三四五六'[new Date(`${date}T00:00:00`).getDay()]}`)
/** 今天之后最近一次有题到期的日子 */
const nextDue = computed(() => {
  const f = summary.value?.forecast ?? []
  const i = f.findIndex((d, k) => k > 0 && d.count > 0)
  return i > 0 ? { label: weekday(f[i]!.date, i), count: f[i]!.count } : null
})
</script>

<template>
  <div class="page container">
    <header class="page-head">
      <p class="eyebrow">SPACED REPETITION · 间隔复习</p>
      <h1 class="serif">今日复习</h1>
      <p class="sub">按遗忘规律安排复习：记得牢的题，下次间隔越来越长；没记住的题，很快会再出现。</p>
    </header>

    <div v-if="!loggedIn" class="notice card">
      <p>复习计划保存在账号里，登录后才能使用。标记过"不会、模糊、掌握"的题和 AI 面试过的题，会自动加入计划。</p>
      <NuxtLink to="/login?redirect=/review" class="btn btn-primary">登录</NuxtLink>
    </div>

    <template v-else>
      <section class="stats">
        <div class="stat">
          <span class="stat-label">今日待复习</span>
          <strong class="serif">{{ summary?.dueToday ?? '—' }}</strong>
        </div>
        <div class="stat">
          <span class="stat-label">今日已复习</span>
          <strong class="serif">{{ summary?.doneToday ?? '—' }}</strong>
        </div>
        <div class="stat">
          <span class="stat-label">连续复习</span>
          <strong class="serif">{{ summary?.streak ?? '—' }}<small> 天</small></strong>
        </div>
        <div class="stat forecast" aria-label="未来 7 天到期的题数">
          <span class="stat-label">未来 7 天</span>
          <ol class="bars">
            <li v-for="(f, i) in summary?.forecast ?? []" :key="f.date" :title="`${weekday(f.date, i)}：${f.count} 道`">
              <span class="bar" :style="{ height: `${Math.max(4, (f.count / forecastMax) * 100)}%` }" :class="{ today: i === 0, empty: !f.count }" />
              <span class="day">{{ i === 0 ? '今' : i === 1 ? '明' : weekday(f.date, i).slice(-1) }}</span>
            </li>
          </ol>
        </div>
      </section>

      <div v-if="loading" class="placeholder card">正在加载复习列表…</div>

      <!-- 复习卡片 -->
      <section v-else-if="current" class="session">
        <div class="session-top">
          <span class="counter">第 <b>{{ index + 1 }}</b> / {{ total }} 题</span>
          <div class="track" aria-hidden="true"><span :style="{ width: `${(index / total) * 100}%` }" /></div>
        </div>

        <article class="review-card card">
          <p class="meta">
            <span class="num">No.{{ current.num }}</span>
            <span>{{ current.category }}</span>
            <span>{{ DIFFICULTY_LABELS[current.difficulty] }}</span>
            <span v-if="current.lapses" class="lapses">忘过 {{ current.lapses }} 次</span>
          </p>
          <h2 class="serif q-title"><RichTitle :title="current.title" /></h2>

          <div v-if="!revealed" class="think">
            <p>先在心里回答一遍，最好说出声来，再看答案。</p>
            <button type="button" class="btn btn-primary" @click="revealed = true">显示答案 <kbd>空格</kbd></button>
          </div>

          <template v-else>
            <div class="answer doc-content">
              <p class="answer-title">一句话回答</p>
              <!-- 来自题库的预渲染 HTML -->
              <div v-html="current.answerHtml" />
            </div>
            <p class="more">
              <NuxtLink :to="current.path" target="_blank">看完整解析 ↗</NuxtLink>
              <NuxtLink :to="`${current.path}#interview`" target="_blank" class="ai-link">让 AI 考考这题 ↗</NuxtLink>
            </p>

            <p class="rate-tip">你刚才答得怎么样？</p>
            <div class="grades">
              <button
                v-for="g in GRADES"
                :key="g.grade"
                type="button"
                class="grade"
                :class="g.key"
                :disabled="rating"
                @click="rate(g.grade)"
              >
                <span class="grade-label"><kbd>{{ g.grade }}</kbd>{{ g.label }}</span>
                <span class="grade-hint">{{ g.hint }}</span>
                <span class="grade-next">{{ intervalText(current.intervals[g.grade]) }}再复习</span>
              </button>
            </div>
          </template>
        </article>
        <p v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</p>
      </section>

      <!-- 今天的都复习完了 -->
      <section v-else-if="summary && summary.total" class="done card">
        <span class="done-mark" aria-hidden="true">✓</span>
        <h2 class="serif">{{ doneNow ? `今天复习了 ${doneNow} 道，全部完成` : '今天没有要复习的题' }}</h2>
        <p v-if="nextDue">下一次复习在{{ nextDue.label }}，有 {{ nextDue.count }} 道题。</p>
        <p v-else>未来一周都没有到期的题，可以学点新题，或者来一场模拟面试。</p>
        <div class="done-actions">
          <NuxtLink to="/mock" class="btn btn-ai">开始模拟面试</NuxtLink>
          <NuxtLink to="/progress" class="btn">看看还有哪些没学</NuxtLink>
        </div>
      </section>

      <!-- 还没有复习计划 -->
      <section v-else class="done card">
        <span class="done-mark empty" aria-hidden="true">＋</span>
        <h2 class="serif">复习计划还是空的</h2>
        <p>在题目页标记"不会、模糊、掌握"，或者让 AI 面试官考一道题，这道题就会加入复习计划，到时间自动出现在这里。</p>
        <div class="done-actions">
          <NuxtLink to="/progress" class="btn btn-primary">去刷题</NuxtLink>
          <NuxtLink to="/mock" class="btn">开始模拟面试</NuxtLink>
        </div>
      </section>

      <details class="how">
        <summary>复习时间是怎么安排的？</summary>
        <p>
          用的是 FSRS 间隔重复算法。每道题记录"记忆稳定性"和"难度"：评"会了""很熟"，稳定性提高，下次间隔拉长；评"不会"，间隔缩短到一两天。目标是在你快要忘记时提醒复习，用最少的次数记得最牢。最长间隔约 4 个月。
        </p>
        <p>这些操作都会更新复习计划：在这里评分、在题目页标记掌握程度、AI 面试第一轮的得分（4 分及以下算不会，5～7 模糊，8～9 会了，10 很熟）。</p>
      </details>
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 880px;
  padding-top: 48px;
  padding-bottom: 80px;
}

.page-head h1 {
  margin: 10px 0 0;
  font-size: clamp(32px, 4vw, 44px);
  font-weight: 800;
}

.sub {
  margin: 10px 0 0;
  color: var(--c-text-2);
}

.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 32px;
  padding: 20px 24px;
}

.notice p {
  flex: 1 1 320px;
  margin: 0;
  color: var(--c-text-2);
}

/* 统计 */
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.6fr);
  gap: 12px;
  margin-top: 32px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
}

.stat-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--c-text-3);
}

.stat strong {
  font-size: 30px;
  font-weight: 800;
  line-height: 1.1;
}

.stat small {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-3);
}

.bars {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  min-height: 52px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bars li {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
}

.bar {
  width: 100%;
  max-width: 22px;
  border-radius: 4px 4px 2px 2px;
  background: color-mix(in srgb, var(--c-brand) 35%, var(--c-bg-mute));
}

.bar.today {
  background: var(--c-brand);
}

.bar.empty {
  background: var(--c-bg-mute);
}

.day {
  font-size: 11px;
  color: var(--c-text-3);
}

.placeholder {
  margin-top: 24px;
  padding: 48px;
  text-align: center;
  color: var(--c-text-3);
}

/* 复习卡片 */
.session {
  margin-top: 28px;
}

.session-top {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}

.counter {
  flex: none;
  font-size: 13px;
  color: var(--c-text-2);
}

.counter b {
  color: var(--c-text-1);
}

.track {
  flex: 1;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--c-bg-mute);
}

.track span {
  display: block;
  height: 100%;
  background: var(--c-brand);
  transition: width var(--dur-slow, 300ms) var(--ease);
}

.review-card {
  padding: 28px 32px 30px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  font-size: 12.5px;
  color: var(--c-text-3);
}

.meta .num {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--c-brand);
}

.lapses {
  color: var(--st-weak-text);
}

.q-title {
  margin: 10px 0 0;
  font-size: clamp(22px, 3vw, 28px);
  font-weight: 800;
  line-height: 1.35;
}

.think {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 28px;
  padding: 18px 20px;
  border: 1px dashed var(--c-border);
  border-radius: var(--r-md);
}

.think p {
  margin: 0;
  color: var(--c-text-2);
}

.think kbd,
.grade kbd {
  margin-left: 6px;
  font-size: 11px;
}

.answer {
  margin-top: 24px;
  padding: 18px 22px;
  border-left: 3px solid var(--c-brand);
  border-radius: 0 var(--r-md) var(--r-md) 0;
  background: var(--c-brand-softer);
}

.answer-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--c-brand);
}

.answer :deep(p) {
  margin: 0;
}

.more {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  margin: 12px 0 0;
  font-size: 13.5px;
}

.ai-link {
  color: var(--ai-text);
}

.rate-tip {
  margin: 26px 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text-2);
}

.grades {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.grade {
  --tone: var(--c-brand);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg);
  color: var(--c-text-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}

.grade.weak {
  --tone: var(--st-weak);
}

.grade.fuzzy {
  --tone: var(--st-fuzzy);
}

.grade.good {
  --tone: var(--st-mastered);
}

.grade.easy {
  --tone: var(--c-brand);
}

.grade:hover:not(:disabled) {
  border-color: var(--tone);
  background: color-mix(in srgb, var(--tone) 8%, var(--c-bg));
}

.grade:disabled {
  opacity: 0.6;
  cursor: wait;
}

.grade-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
}

.grade-label kbd {
  order: 2;
  margin-left: auto;
}

.grade-label::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tone);
}

.grade-hint {
  font-size: 12px;
  color: var(--c-text-3);
}

.grade-next {
  margin-top: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-2);
}

.error {
  margin: 12px 0 0;
  color: var(--st-weak-text);
}

/* 完成 / 空状态 */
.done {
  margin-top: 28px;
  padding: 44px 32px;
  text-align: center;
}

.done-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--st-mastered) 16%, transparent);
  font-size: 24px;
  font-weight: 700;
  color: var(--st-mastered-text);
}

.done-mark.empty {
  background: var(--c-brand-soft);
  color: var(--c-brand);
}

.done h2 {
  margin: 16px 0 0;
  font-size: 24px;
  font-weight: 800;
}

.done p {
  max-width: 520px;
  margin: 10px auto 0;
  color: var(--c-text-2);
}

.done-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 24px;
}

.how {
  margin-top: 28px;
  font-size: 13.5px;
  color: var(--c-text-2);
}

.how summary {
  cursor: pointer;
  font-weight: 600;
}

.how p {
  margin: 10px 0 0;
  line-height: 1.8;
}

@media (max-width: 760px) {
  .stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .forecast {
    grid-column: 1 / -1;
  }

  .review-card {
    padding: 22px 18px 24px;
  }

  .grades {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .grade-label kbd {
    display: none;
  }
}
</style>
