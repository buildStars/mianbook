<script setup lang="ts">
import type { AdminDashboard } from '#shared/types/admin'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '概览 | 全栈面试手册' })

// 按浏览器所在时区统计每天的数据，所以在客户端请求
const data = ref<AdminDashboard | null>(null)
const loading = ref(true)
const failed = ref('')

async function load() {
  loading.value = true
  failed.value = ''
  try {
    data.value = await $fetch<AdminDashboard>('/api/admin/dashboard', { query: { tz: new Date().getTimezoneOffset() } })
  } catch (error) {
    failed.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

const aiChart = computed(() =>
  (data.value?.ai.daily ?? []).map((d) => ({ label: shortDate(d.date), values: [d.site, d.own] })),
)
const activeChart = computed(() =>
  (data.value?.activity.daily ?? []).map((d) => ({ label: shortDate(d.date), values: [d.active] })),
)
const activeMax = computed(() => Math.max(1, ...(data.value?.activity.daily ?? []).map((d) => d.active)))

/** 环比：最近 7 天比再往前 7 天 */
const aiTrend = computed(() => {
  const ai = data.value?.ai
  if (!ai || !ai.sitePrev7d) return null
  const pct = Math.round(((ai.site7d - ai.sitePrev7d) / ai.sitePrev7d) * 100)
  return { pct, up: pct >= 0 }
})

const kindMax = computed(() => Math.max(1, ...(data.value?.ai.byKind ?? []).map((k) => k.site + k.own)))

const mockRate = computed(() => {
  const l = data.value?.learning
  return l?.mockStarted ? Math.round((l.mockFinished / l.mockStarted) * 100) : null
})

const editLink = (id: number) => `/admin/questions/${id}`
</script>

<template>
  <div class="dash">
    <AdminPageHead eyebrow="运营 · 最近 14 天" title="概览">
      <template #desc>按你所在的时区统计；活跃指当天阅读、复习、面试或调用过 AI。</template>
      <button type="button" class="btn btn-sm" :disabled="loading" @click="load">
        <AdminIcon name="sync" :size="15" />刷新
      </button>
      <NuxtLink to="/admin/questions/new" class="btn btn-sm btn-primary"><AdminIcon name="plus" :size="15" />新建题目</NuxtLink>
    </AdminPageHead>

    <div v-if="failed" class="a-alert bad"><AdminIcon name="alert" :size="16" />{{ failed }}</div>

    <template v-if="data">
      <ul v-if="data.alerts.length" class="alerts">
        <li v-for="a in data.alerts" :key="a.text" class="a-alert" :class="a.level">
          <AdminIcon :name="a.level === 'warn' ? 'alert' : 'info'" :size="16" />
          <span>{{ a.text }}</span>
          <NuxtLink v-if="a.to" :to="a.to" class="a-alert-action">{{ a.action }} →</NuxtLink>
        </li>
      </ul>

      <!-- 关键指标 -->
      <section class="kpis" aria-label="关键指标">
        <div class="a-card kpi">
          <p class="kpi-label"><AdminIcon name="pulse" :size="15" />今日活跃</p>
          <p class="kpi-value a-num">{{ data.activity.dau }}<small>人</small></p>
          <p class="kpi-sub">近 7 天 {{ data.activity.wau }} · 近 30 天 {{ data.activity.mau }}</p>
          <div class="spark" aria-hidden="true">
            <i v-for="d in data.activity.daily" :key="d.date" :style="{ height: `${Math.max(6, (d.active / activeMax) * 100)}%` }" :class="{ zero: !d.active }" />
          </div>
        </div>
        <div class="a-card kpi">
          <p class="kpi-label"><AdminIcon name="sparkle" :size="15" />AI 调用 · 近 7 天</p>
          <p class="kpi-value a-num">
            {{ compactNumber(data.ai.site7d) }}<small>次</small>
            <span v-if="aiTrend" class="trend" :class="{ up: aiTrend.up }">{{ aiTrend.up ? '↑' : '↓' }} {{ Math.abs(aiTrend.pct) }}%</span>
          </p>
          <p class="kpi-sub">站点 Key；用户自带 Key 14 天 {{ data.ai.own14d }} 次</p>
        </div>
        <div class="a-card kpi">
          <p class="kpi-label"><AdminIcon name="coin" :size="15" />估算花费 · 14 天</p>
          <p v-if="data.ai.cost" class="kpi-value a-num">{{ formatMoney(data.ai.cost) }}</p>
          <p v-else class="kpi-value a-num muted-value">—</p>
          <p class="kpi-sub">
            输入 {{ compactNumber(data.ai.promptTokens) }} · 输出 {{ compactNumber(data.ai.completionTokens) }} tokens
          </p>
          <NuxtLink v-if="!data.ai.cost" to="/admin/ai" class="kpi-link">填写价格后显示 →</NuxtLink>
        </div>
        <div class="a-card kpi">
          <p class="kpi-label"><AdminIcon name="book" :size="15" />题库</p>
          <p class="kpi-value a-num">{{ data.content.published }}<small>/ {{ data.content.total }} 道已发布</small></p>
          <p class="kpi-sub">{{ data.content.categories }} 个分类 · {{ data.content.drafts }} 道草稿 · {{ data.activity.users }} 位用户</p>
        </div>
      </section>

      <!-- AI 用量 -->
      <section class="row two">
        <div class="a-card">
          <div class="a-card-head">
            <h2>AI 用量</h2>
            <span class="aside">
              模型 <span class="a-code">{{ data.ai.model || '未设置' }}</span>
              <template v-if="data.ai.untracked"> · {{ data.ai.untracked }} 次没有返回 token 用量，不计入花费</template>
            </span>
          </div>
          <div class="a-card-body">
            <AdminBarChart
              :data="aiChart"
              :series="[
                { name: '站点 Key', color: 'var(--c-brand-solid)' },
                { name: '用户自带 Key', color: 'color-mix(in srgb, var(--c-brand) 28%, var(--c-bg-mute))' },
              ]"
              unit=" 次"
            />
          </div>
        </div>
        <div class="a-card">
          <div class="a-card-head"><h2>按功能</h2><span class="aside">14 天</span></div>
          <div class="a-card-body">
            <ul class="kinds">
              <li v-for="k in data.ai.byKind" :key="k.kind">
                <div class="kind-line">
                  <span>{{ AI_KIND_LABELS[k.kind] }}</span>
                  <span class="a-num">{{ k.site + k.own }}</span>
                </div>
                <div class="kind-bar" aria-hidden="true">
                  <i class="site" :style="{ width: `${(k.site / kindMax) * 100}%` }" />
                  <i class="own" :style="{ width: `${(k.own / kindMax) * 100}%` }" />
                </div>
                <p class="kind-sub">站点 {{ k.site }} · 自带 {{ k.own }}</p>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- AI 性能和错误 -->
      <section class="row two">
        <div class="a-card">
          <div class="a-card-head">
            <h2>AI 性能</h2>
            <span class="aside">近 7 天 · 延迟只算正常结束的调用</span>
          </div>
          <div class="a-card-body">
            <p v-if="!data.perf.byKind.length" class="a-empty">最近 7 天没有 AI 调用</p>
            <div v-else class="perf-wrap">
              <table class="perf">
                <thead>
                  <tr>
                    <th>功能</th>
                    <th class="n">调用</th>
                    <th class="n">出错率</th>
                    <th class="n" title="收到第一段输出的时间">首字 P50 / P95</th>
                    <th class="n">总耗时 P50 / P95</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in [...data.perf.byKind, data.perf.overall]" :key="r.kind" :class="{ total: r.kind === 'all' }">
                    <td>{{ r.kind === 'all' ? '全部' : AI_KIND_LABELS[r.kind] }}</td>
                    <td class="n a-num">{{ r.calls }}</td>
                    <td class="n a-num" :class="{ bad: r.errorRate >= 0.05 }">{{ (r.errorRate * 100).toFixed(1) }}%</td>
                    <td class="n a-mono">{{ formatMs(r.ttftP50) }} / {{ formatMs(r.ttftP95) }}</td>
                    <td class="n a-mono">{{ formatMs(r.latencyP50) }} / {{ formatMs(r.latencyP95) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul v-if="data.perf.recentErrors.length" class="err-list">
              <li v-for="(e, i) in data.perf.recentErrors" :key="i">
                <span class="err-meta">{{ formatDateTime(e.at) }} · {{ aiKindLabel(e.kind) }}{{ e.model ? ` · ${e.model}` : '' }}</span>
                <span class="err-msg">{{ e.error }}</span>
              </li>
            </ul>
          </div>
        </div>
        <div class="a-card">
          <div class="a-card-head">
            <h2>服务端错误</h2>
            <span class="aside">近 7 天 {{ data.errors.count7d }} 条 · 同样的错误一分钟只记一次</span>
          </div>
          <div class="a-card-body">
            <p v-if="!data.errors.recent.length" class="a-empty">没有 5xx 错误</p>
            <ul v-else class="err-list">
              <li v-for="(e, i) in data.errors.recent" :key="i">
                <span class="err-meta">{{ formatDateTime(e.at) }} · {{ e.statusCode }} · {{ e.method }} {{ e.path }}</span>
                <span class="err-msg">{{ e.message }}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- 学习数据 -->
      <section class="row two">
        <div class="a-card">
          <div class="a-card-head"><h2>学习数据</h2><span class="aside">近 7 天</span></div>
          <div class="a-card-body">
            <dl class="stats">
              <div>
                <dt>阅读</dt>
                <dd><span class="a-num">{{ data.learning.reads }}</span> 次</dd>
                <p>共 {{ formatSeconds(data.learning.readSeconds) }}</p>
              </div>
              <div>
                <dt>复习评分</dt>
                <dd><span class="a-num">{{ data.learning.reviews }}</span> 次</dd>
                <p>间隔重复和题目页标记</p>
              </div>
              <div>
                <dt>AI 单题面试</dt>
                <dd><span class="a-num">{{ data.learning.interviews }}</span> 次</dd>
                <p>平均 {{ data.learning.interviewAvg ?? '—' }} 分</p>
              </div>
              <div>
                <dt>整场模拟面试</dt>
                <dd><span class="a-num">{{ data.learning.mockFinished }}</span> / {{ data.learning.mockStarted }} 场</dd>
                <p>完成率 {{ mockRate === null ? '—' : `${mockRate}%` }} · 平均 {{ data.learning.mockAvg ?? '—' }} 分</p>
              </div>
            </dl>
          </div>
        </div>
        <div class="a-card">
          <div class="a-card-head">
            <h2>每日活跃</h2>
            <span class="aside">新用户 7 天 {{ data.activity.newUsers7d }} 位</span>
          </div>
          <div class="a-card-body">
            <AdminBarChart :data="activeChart" :series="[{ name: '活跃用户', color: 'var(--c-ink)' }]" :height="150" unit=" 人" />
          </div>
        </div>
      </section>

      <!-- 题目难度榜 -->
      <section class="a-card board">
        <div class="a-card-head">
          <h2>题目难度榜</h2>
          <span class="aside">找出需要改写或补充的题</span>
        </div>
        <div class="board-cols">
          <div class="board-col">
            <h3>面试得分最低</h3>
            <p class="board-desc">AI 面试第一轮的平均分，至少 2 次面试</p>
            <ol v-if="data.board.lowScore.length">
              <li v-for="(q, i) in data.board.lowScore" :key="q.id">
                <span class="rank a-num">{{ String(i + 1).padStart(2, '0') }}</span>
                <NuxtLink :to="editLink(q.id)" class="q-title"><RichTitle :title="q.title" /></NuxtLink>
                <span class="metric"><strong class="a-num" :class="{ low: q.avg < 5 }">{{ q.avg }}</strong> 分 · {{ q.count }} 次</span>
              </li>
            </ol>
            <p v-else class="a-empty">还没有足够的面试数据</p>
          </div>
          <div class="board-col">
            <h3>最常复习"不会"</h3>
            <p class="board-desc">最近 30 天复习时评为"不会"的次数</p>
            <ol v-if="data.board.forgotten.length">
              <li v-for="(q, i) in data.board.forgotten" :key="q.id">
                <span class="rank a-num">{{ String(i + 1).padStart(2, '0') }}</span>
                <NuxtLink :to="editLink(q.id)" class="q-title"><RichTitle :title="q.title" /></NuxtLink>
                <span class="metric"><strong class="a-num">{{ q.count }}</strong> 次 · {{ q.users }} 人</span>
              </li>
            </ol>
            <p v-else class="a-empty">最近 30 天没有"不会"的评分</p>
          </div>
          <div class="board-col">
            <h3>阅读最多</h3>
            <p class="board-desc">最近 30 天阅读的人数</p>
            <ol v-if="data.board.popular.length">
              <li v-for="(q, i) in data.board.popular" :key="q.id">
                <span class="rank a-num">{{ String(i + 1).padStart(2, '0') }}</span>
                <NuxtLink :to="editLink(q.id)" class="q-title"><RichTitle :title="q.title" /></NuxtLink>
                <span class="metric"><strong class="a-num">{{ q.users }}</strong> 人 · {{ formatSeconds(q.seconds) }}</span>
              </li>
            </ol>
            <p v-else class="a-empty">最近 30 天还没有阅读记录</p>
          </div>
        </div>
      </section>

      <!-- 最近修改 -->
      <section class="a-card">
        <div class="a-card-head">
          <h2>最近修改</h2>
          <NuxtLink to="/admin/questions" class="aside-link">全部题目 →</NuxtLink>
        </div>
        <ul class="recent">
          <li v-for="q in data.content.recent" :key="q.id">
            <NuxtLink :to="editLink(q.id)" class="q-title"><RichTitle :title="q.title" /></NuxtLink>
            <AdminStatusChip :status="q.status" />
            <time :datetime="q.updatedAt" :title="formatDateTime(q.updatedAt)">{{ relativeTime(q.updatedAt) }}</time>
          </li>
        </ul>
      </section>
    </template>

    <!-- 首次加载的占位 -->
    <div v-else-if="loading" class="skeleton" aria-busy="true" aria-label="加载中">
      <div class="kpis"><div v-for="n in 4" :key="n" class="a-card sk" /></div>
      <div class="row two"><div class="a-card sk tall" /><div class="a-card sk tall" /></div>
    </div>
  </div>
</template>

<style scoped>
.perf-wrap {
  overflow-x: auto;
}

.perf {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.perf th {
  padding: 6px 8px;
  border-bottom: 1px solid var(--c-divider);
  color: var(--c-text-3);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}

.perf td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--c-divider);
  white-space: nowrap;
}

.perf .n {
  text-align: right;
}

.perf tr.total td {
  border-bottom: 0;
  font-weight: 600;
}

.perf .bad {
  color: var(--c-danger);
}

.err-list {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.err-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--c-danger-soft);
  min-width: 0;
}

.err-meta {
  font-size: 12px;
  color: var(--c-text-3);
}

.err-msg {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--c-danger);
  overflow-wrap: anywhere;
}

.dash {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dash > :deep(.a-head) {
  margin-bottom: 8px;
}

.alerts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* ---------- 关键指标 ---------- */
.kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.kpi {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 132px;
  padding: 16px 18px;
  overflow: hidden;
}

.kpi-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  color: var(--c-text-2);
}

.kpi-label .a-icon {
  color: var(--c-text-3);
}

.kpi-value {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 6px 0 0;
  font-size: 34px;
  font-weight: 700;
  line-height: 1.15;
}

.kpi-value small {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-3);
}

.muted-value {
  color: var(--c-text-3);
}

.kpi-sub {
  margin: auto 0 0;
  padding-top: 8px;
  font-size: 12.5px;
  color: var(--c-text-3);
}

.kpi-link {
  font-size: 12.5px;
  font-weight: 600;
}

.trend {
  padding: 2px 7px;
  border-radius: var(--r-full);
  background: var(--c-default-soft);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-2);
}

.trend.up {
  background: var(--c-brand-soft);
  color: var(--c-brand);
}

.spark {
  position: absolute;
  top: 18px;
  right: 18px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  width: 84px;
  height: 34px;
}

.spark i {
  flex: 1;
  border-radius: 1px;
  background: var(--c-brand);
  opacity: 0.75;
}

.spark i.zero {
  background: var(--c-bg-mute);
  opacity: 1;
}

/* ---------- 布局 ---------- */
.row {
  display: grid;
  gap: 16px;
}

.row.two {
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
}

/* ---------- 按功能 ---------- */
.kinds {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.kind-line {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 500;
}

.kind-line .a-num {
  font-size: 18px;
  font-weight: 700;
}

.kind-bar {
  display: flex;
  height: 8px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--c-bg-mute);
}

.kind-bar .site {
  background: var(--c-brand-solid);
}

.kind-bar .own {
  background: color-mix(in srgb, var(--c-brand) 28%, var(--c-bg-mute));
}

.kind-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

/* ---------- 学习数据 ---------- */
.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-divider);
}

.stats > div {
  padding: 14px 16px;
  background: var(--c-bg-elv);
}

.stats dt {
  font-size: 13px;
  color: var(--c-text-2);
}

.stats dd {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--c-text-3);
}

.stats dd .a-num {
  font-size: 26px;
  font-weight: 700;
  color: var(--c-text-1);
}

.stats p {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

/* ---------- 难度榜 ---------- */
.board-cols {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 12px;
  border-top: 1px solid var(--c-divider);
}

.board-col {
  padding: 16px 20px 18px;
}

.board-col + .board-col {
  border-left: 1px solid var(--c-divider);
}

.board-col h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.board-desc {
  margin: 2px 0 10px;
  font-size: 12px;
  color: var(--c-text-3);
}

.board-col ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.board-col li {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 0 6px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--c-divider);
}

.board-col li:last-child {
  border-bottom: none;
}

.rank {
  grid-row: span 2;
  padding-top: 1px;
  font-size: 13px;
  color: var(--c-text-3);
}

.q-title {
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-1);
}

.q-title:hover {
  color: var(--c-brand);
}

.metric {
  font-size: 12px;
  color: var(--c-text-3);
}

.metric strong {
  font-size: 13px;
  color: var(--c-text-1);
}

.metric strong.low {
  color: var(--st-weak-text);
}

/* ---------- 最近修改 ---------- */
.aside-link {
  font-size: 13px;
  font-weight: 500;
}

.recent {
  margin: 8px 0 0;
  padding: 0 0 6px;
  list-style: none;
}

.recent li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  border-top: 1px solid var(--c-divider);
}

.recent .q-title {
  flex: 1;
  min-width: 0;
}

.recent time {
  flex: none;
  width: 72px;
  font-size: 12.5px;
  text-align: right;
  color: var(--c-text-3);
}

/* ---------- 占位 ---------- */
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sk {
  height: 132px;
  background: linear-gradient(90deg, var(--c-bg-elv), var(--c-bg-soft), var(--c-bg-elv));
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite linear;
}

.sk.tall {
  height: 280px;
}

@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 1100px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .row.two {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 900px) {
  .board-cols {
    grid-template-columns: minmax(0, 1fr);
  }

  .board-col + .board-col {
    border-top: 1px solid var(--c-divider);
    border-left: none;
  }
}

@media (max-width: 520px) {
  .kpis {
    grid-template-columns: minmax(0, 1fr);
  }

  .kpi {
    min-height: 0;
  }

  .stats {
    grid-template-columns: minmax(0, 1fr);
  }

  .recent li {
    flex-wrap: wrap;
    padding: 10px 16px;
  }

  .recent .q-title {
    flex-basis: 100%;
  }
}
</style>
