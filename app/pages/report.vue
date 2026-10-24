<script setup lang="ts">
import type { WeekStats, WeeklyReport } from '#shared/types/handbook'

useHead({ title: '学习周报' })

const { loggedIn } = useUserSession()
const report = ref<WeeklyReport | null>(null)
const loading = ref(true)
const offset = ref(0)

async function load() {
  if (!loggedIn.value) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    report.value = await $fetch<WeeklyReport>('/api/report/weekly', {
      query: { tz: new Date().getTimezoneOffset(), offset: offset.value },
    })
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch([offset, loggedIn], load)

const fmtDate = (d: string) => `${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日`
const weekLabel = computed(() => {
  if (!report.value) return ''
  const { start, end, offset: o } = report.value.week
  const name = o === 0 ? '本周' : o === -1 ? '上周' : `${-o} 周前`
  return `${name} · ${fmtDate(start)} – ${fmtDate(end)}`
})

/** 时长：2 小时 15 分、35 分钟、不到 1 分钟 */
function duration(seconds: number) {
  if (!seconds) return '0 分钟'
  const m = Math.round(seconds / 60)
  if (m < 1) return '不到 1 分钟'
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}`
}

/** 和上周比：正数绿色、负数红色，平均分保留一位小数 */
function delta(key: keyof WeekStats, unit = '') {
  const r = report.value
  if (!r) return null
  const cur = r.current[key]
  const prev = r.previous[key]
  if (cur === null || prev === null) return null
  const d = Math.round(((cur as number) - (prev as number)) * 10) / 10
  // 学习时长差不到 1 分钟也算持平，免得出现"比上周多不到 1 分钟"
  if (!d || (key === 'studySeconds' && Math.abs(d) < 60)) return { text: '和上周持平', tone: '' }
  const shown = key === 'studySeconds' ? duration(Math.abs(d)) : `${Math.abs(d)}${unit}`
  return { text: `比上周${d > 0 ? '多' : '少'} ${shown}`, tone: d > 0 ? 'up' : 'down' }
}

const cards = computed(() => {
  const c = report.value?.current
  if (!c) return []
  return [
    { label: '学习时长', value: duration(c.studySeconds), sub: delta('studySeconds') },
    { label: '学习天数', value: `${c.activeDays} / 7`, sub: delta('activeDays', ' 天') },
    { label: '读过的题', value: `${c.questionsRead} 道`, sub: delta('questionsRead', ' 道') },
    { label: '复习评分', value: `${c.reviews} 次`, sub: { text: `其中新学 ${c.newQuestions} 道`, tone: '' } },
    {
      label: 'AI 面试',
      value: c.interviews ? `${c.interviews} 题 · ${c.interviewAvg ?? '—'} 分` : '0 题',
      sub: delta('interviewAvg', ' 分'),
    },
    {
      label: '模拟面试',
      value: c.mockFinished ? `${c.mockFinished} 场 · ${c.mockAvg ?? '—'} 分` : '0 场',
      sub: c.voiceSeconds ? { text: `语音作答 ${duration(c.voiceSeconds)}`, tone: '' } : null,
    },
  ]
})

const dayMax = computed(() => Math.max(60, ...(report.value?.daily.map((d) => d.seconds) ?? [0])))
const weekday = (i: number) => `周${'一二三四五六日'[i]}`

/** 8 周趋势：柱子是学习时长，折线是 AI 面试平均分（0～10） */
const TW = 560
const TH = 160
const trendChart = computed(() => {
  const t = report.value?.trend ?? []
  const max = Math.max(60, ...t.map((w) => w.seconds))
  const step = TW / Math.max(1, t.length)
  const bars = t.map((w, i) => {
    const h = Math.round((w.seconds / max) * (TH - 30))
    return { x: Math.round(i * step + step * 0.25), w: Math.round(step * 0.5), y: TH - 20 - h, h, label: fmtDate(w.start).replace(' 月 ', '/').replace(' 日', '') }
  })
  const points = t
    .map((w, i) => (w.interviewAvg === null ? null : { x: Math.round(i * step + step / 2), y: Math.round(TH - 20 - (w.interviewAvg / 10) * (TH - 30)), v: w.interviewAvg }))
    .filter((p): p is { x: number; y: number; v: number } => p !== null)
  return { bars, points, line: points.map((p) => `${p.x},${p.y}`).join(' ') }
})

const hasData = computed(() => {
  const c = report.value?.current
  return !!c && (c.studySeconds > 0 || c.reviews > 0 || c.interviews > 0 || c.mockFinished > 0)
})
</script>

<template>
  <div class="page container">
    <header class="page-head">
      <p class="eyebrow">WEEKLY REPORT · 学习周报</p>
      <h1 class="serif">学习周报</h1>
      <p class="sub">这一周学了多少、哪里最卡、下周该怎么安排。数据只来自你自己的学习记录。</p>
    </header>

    <div v-if="!loggedIn" class="notice card">
      <p>学习周报需要登录，阅读时长、复习和面试记录都保存在账号里。</p>
      <NuxtLink to="/login?redirect=/report" class="btn btn-primary">登录</NuxtLink>
    </div>

    <template v-else>
      <nav class="week-nav" aria-label="切换周">
        <button type="button" class="btn btn-sm btn-ghost" :disabled="loading || offset <= -52" @click="offset--">‹ 上一周</button>
        <span class="week-label">{{ weekLabel || '…' }}</span>
        <button type="button" class="btn btn-sm btn-ghost" :disabled="loading || offset >= 0" @click="offset++">下一周 ›</button>
      </nav>

      <div v-if="loading && !report" class="placeholder card">正在生成周报…</div>

      <template v-else-if="report">
        <section class="cards" :class="{ dim: loading }">
          <div v-for="c in cards" :key="c.label" class="stat">
            <span class="stat-label">{{ c.label }}</span>
            <strong class="serif">{{ c.value }}</strong>
            <span v-if="c.sub" class="stat-sub" :class="c.sub.tone">{{ c.sub.text }}</span>
          </div>
        </section>

        <section v-if="report.suggestions.length" class="suggest card">
          <p class="block-title">下周建议</p>
          <ul>
            <li v-for="(s, i) in report.suggestions" :key="i">
              {{ s.text }}
              <NuxtLink v-if="s.link" :to="s.link.to" class="suggest-link">{{ s.link.label }} →</NuxtLink>
            </li>
          </ul>
        </section>

        <div class="grid">
          <section class="card chart">
            <p class="block-title">每天学习时长</p>
            <ol class="days">
              <li v-for="(d, i) in report.daily" :key="d.date" :title="`${fmtDate(d.date)}：阅读 ${duration(d.seconds)}，复习 ${d.reviews} 次，AI 面试 ${d.interviews} 题`">
                <span class="day-val">{{ d.seconds ? (d.seconds < 60 ? '<1' : Math.round(d.seconds / 60)) : '' }}</span>
                <span class="day-bar"><i :style="{ height: `${Math.max(d.seconds ? 4 : 0, (d.seconds / dayMax) * 100)}%` }" /></span>
                <span class="day-marks" aria-hidden="true">
                  <b v-if="d.reviews" class="m-review" />
                  <b v-if="d.interviews" class="m-ai" />
                </span>
                <span class="day-name">{{ weekday(i) }}</span>
              </li>
            </ol>
            <p class="legend"><span>柱子：阅读分钟数</span><span><b class="m-review" />复习过</span><span><b class="m-ai" />AI 面试过</span></p>
          </section>

          <section class="card chart">
            <p class="block-title">最近 8 周</p>
            <svg :viewBox="`0 0 ${TW} ${TH}`" class="trend" role="img" aria-label="最近 8 周学习时长和 AI 面试平均分">
              <line :x1="0" :x2="TW" :y1="TH - 20" :y2="TH - 20" class="axis" />
              <g v-for="(b, i) in trendChart.bars" :key="i">
                <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="3" class="tbar" :class="{ cur: i === trendChart.bars.length - 1 }" />
                <text :x="b.x + b.w / 2" :y="TH - 4" text-anchor="middle" class="tlabel">{{ b.label }}</text>
              </g>
              <polyline v-if="trendChart.points.length > 1" :points="trendChart.line" class="tline" />
              <g v-for="(p, i) in trendChart.points" :key="`p${i}`">
                <circle :cx="p.x" :cy="p.y" r="3.5" class="tdot" />
                <text :x="p.x" :y="p.y - 8" text-anchor="middle" class="tval">{{ p.v }}</text>
              </g>
            </svg>
            <p class="legend"><span><b class="m-bar" />学习时长</span><span><b class="m-ai" />AI 面试平均分</span></p>
          </section>
        </div>

        <template v-if="hasData">
          <section v-if="report.stuck.length" class="block">
            <h2 class="serif">本周最卡的题</h2>
            <ul class="stuck">
              <li v-for="q in report.stuck" :key="q.id">
                <NuxtLink :to="q.path"><RichTitle :title="q.title" /></NuxtLink>
                <span>{{ q.category }} · {{ q.reason }}</span>
              </li>
            </ul>
          </section>

          <section v-if="report.categories.length" class="block">
            <h2 class="serif">各分类</h2>
            <table class="cats">
              <thead>
                <tr><th>分类</th><th>阅读</th><th>AI 面试</th><th>平均分</th><th>答"不会"</th></tr>
              </thead>
              <tbody>
                <tr v-for="c in report.categories" :key="c.id">
                  <td>{{ c.title }}</td>
                  <td>{{ duration(c.seconds) }}</td>
                  <td>{{ c.interviews }} 题</td>
                  <td :class="c.avgScore === null ? '' : c.avgScore >= 8 ? 'good' : c.avgScore >= 5 ? 'ok' : 'bad'">{{ c.avgScore ?? '—' }}</td>
                  <td>{{ c.again || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </template>

        <p class="foot">
          连续复习 {{ report.streak }} 天。阅读时长只算页面在前台、并且最近一分钟内有操作的时间；复习评分包括复习页、题目页标记和 AI 面试第一轮。
        </p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 1000px;
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
  margin: 0;
  color: var(--c-text-2);
}

.week-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 28px;
}

.week-label {
  min-width: 200px;
  font-weight: 700;
  text-align: center;
}

.placeholder {
  margin-top: 20px;
  padding: 48px;
  text-align: center;
  color: var(--c-text-3);
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
  transition: opacity var(--dur);
}

.cards.dim {
  opacity: 0.5;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  font-size: 24px;
  font-weight: 800;
}

.stat-sub {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.stat-sub.up {
  color: var(--st-mastered-text);
}

.stat-sub.down {
  color: var(--st-weak-text);
}

.block-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 700;
}

.suggest {
  margin-top: 16px;
  padding: 18px 22px;
  border-left: 3px solid var(--c-brand);
}

.suggest ul {
  margin: 0;
  padding-left: 18px;
  line-height: 1.9;
  color: var(--c-text-2);
}

.suggest-link {
  margin-left: 6px;
  white-space: nowrap;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  margin-top: 16px;
}

.chart {
  padding: 18px 20px;
}

.days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  height: 170px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.days li {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: 0;
}

.day-val {
  height: 16px;
  font-size: 11px;
  color: var(--c-text-3);
}

.day-bar {
  display: flex;
  flex: 1;
  align-items: flex-end;
  width: 100%;
  max-width: 28px;
}

.day-bar i {
  display: block;
  width: 100%;
  border-radius: 4px 4px 2px 2px;
  background: var(--c-brand);
}

.day-marks {
  display: flex;
  gap: 3px;
  height: 8px;
}

.days b,
.legend b {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.m-review {
  background: var(--st-mastered);
}

.m-ai {
  background: var(--ai-via);
}

.m-bar {
  border-radius: 2px !important;
  background: color-mix(in srgb, var(--c-brand) 28%, var(--c-bg-mute));
}

.day-name {
  font-size: 12px;
  color: var(--c-text-2);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.legend b {
  margin-right: 5px;
}

.trend {
  width: 100%;
  height: auto;
}

.axis {
  stroke: var(--c-divider);
}

/* 往周的柱子要看得见：原来用 8% 透明度的品牌色，白底上几乎看不出来 */
.tbar {
  fill: color-mix(in srgb, var(--c-brand) 28%, var(--c-bg-mute));
}

.tbar.cur {
  fill: var(--c-brand-solid);
}

.tlabel {
  font-size: 11px;
  fill: var(--c-text-3);
}

.tline {
  fill: none;
  stroke: var(--ai-via);
  stroke-width: 2;
}

.tdot {
  fill: var(--ai-via);
}

.tval {
  font-size: 11px;
  font-weight: 700;
  fill: var(--ai-text);
}

.block {
  margin-top: 40px;
}

.block h2 {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 800;
}

.stuck {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--c-divider);
}

.stuck li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 16px;
  padding: 12px 2px;
  border-bottom: 1px solid var(--c-divider);
}

.stuck li > span {
  font-size: 12.5px;
  color: var(--st-weak-text);
}

.cats {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.cats th,
.cats td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--c-divider);
  text-align: left;
}

.cats th {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-3);
}

.cats td.good {
  color: var(--st-mastered-text);
  font-weight: 700;
}

.cats td.ok {
  color: var(--st-fuzzy-text);
  font-weight: 700;
}

.cats td.bad {
  color: var(--st-weak-text);
  font-weight: 700;
}

.foot {
  margin-top: 32px;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--c-text-3);
}

@media (max-width: 760px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .week-label {
    min-width: 0;
    flex: 1;
    font-size: 14px;
  }

  .cats th:nth-child(5),
  .cats td:nth-child(5) {
    display: none;
  }
}
</style>
