<script setup lang="ts">
import type { OutlineQuestion, StudyStatus } from '#shared/types/handbook'

useHead({ title: '我的进度 | 全栈面试手册' })

const { outline, all } = useOutline()
const { records, ready, importRecords, clearAll } = useStudy()
const { loggedIn } = useUserSession()

type Filter = 'review' | 'new' | 'star' | 'all'
const filters: { value: Filter; label: string; empty: string }[] = [
  { value: 'review', label: '待复习', empty: '没有待复习的题。标记为"不会""模糊"，或者 AI 面试低于 8 分的题会出现在这里。' },
  { value: 'new', label: '未学', empty: '所有题目都学过了，了不起 🎉' },
  { value: 'star', label: '收藏', empty: '还没有收藏的题目。在题目页点"收藏"就会出现在这里。' },
  { value: 'all', label: '全部', empty: '还没有题目。' },
]
// 默认只列待复习的题；想看全部可以用题目地图或切到"全部"
const filter = ref<Filter>('review')

const statusOf = (q: OutlineQuestion) => records.value[q.id]?.status ?? null

const stats = computed(() => {
  const s = { total: all.value.length, mastered: 0, fuzzy: 0, weak: 0, fresh: 0, star: 0, note: 0 }
  for (const q of all.value) {
    const st = statusOf(q)
    if (st) s[st]++
    else s.fresh++
    if (records.value[q.id]?.starred) s.star++
    if (records.value[q.id]?.note?.trim()) s.note++
  }
  return s
})

const counts = computed<Record<Filter, number>>(() => ({
  review: stats.value.weak + stats.value.fuzzy,
  new: stats.value.fresh,
  star: stats.value.star,
  all: stats.value.total,
}))

/** 环形图：掌握、模糊、不会三段，剩下的是未学 */
const R = 54
const C = 2 * Math.PI * R
const ring = computed(() => {
  const total = stats.value.total || 1
  let offset = 0
  return (['mastered', 'fuzzy', 'weak'] as StudyStatus[]).map((key) => {
    const len = (stats.value[key] / total) * C
    const seg = { key, dash: `${len} ${C - len}`, offset: -offset }
    offset += len
    return seg
  })
})
const pct = computed(() => (stats.value.total ? Math.round((stats.value.mastered / stats.value.total) * 100) : 0))

function matches(q: OutlineQuestion) {
  const st = statusOf(q)
  if (filter.value === 'review') return st === 'weak' || st === 'fuzzy'
  if (filter.value === 'new') return !st
  if (filter.value === 'star') return !!records.value[q.id]?.starred
  return true
}

const view = computed(() =>
  outline.value
    .map((p) => ({
      id: p.id,
      title: p.title,
      groups: p.categories
        .map((c) => ({ id: c.id, title: c.title, items: c.questions.filter(matches) }))
        .filter((g) => g.items.length),
    }))
    .filter((p) => p.groups.length),
)

const emptyText = computed(() => filters.find((f) => f.value === filter.value)!.empty)

const partDone = (questions: OutlineQuestion[]) => questions.filter((q) => statusOf(q) === 'mastered').length
const cellLabel = (q: OutlineQuestion) => {
  const st = statusOf(q)
  return `No.${q.num} ${plainTitle(q.title)} · ${st ? STATUS_LABELS[st] : '未学'}`
}

/** 优先从待复习的题里抽，没有就从未掌握的题里抽 */
function randomPick() {
  const review = all.value.filter((q) => ['weak', 'fuzzy'].includes(statusOf(q) ?? ''))
  const rest = all.value.filter((q) => statusOf(q) !== 'mastered')
  const pool = review.length ? review : rest.length ? rest : all.value
  const pick = pool[Math.floor(Math.random() * pool.length)]
  if (pick) navigateTo(pick.path)
}

const message = ref('')

function onExport() {
  const data = { version: 2, exportedAt: new Date().toISOString(), records: records.value }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `面试手册学习记录-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  message.value = '已导出'
}

async function onImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    const result = await importRecords(data.records ?? data)
    message.value = `已导入 ${result.imported} 条记录${result.skipped ? `，跳过 ${result.skipped} 条（题目不存在或已有更新的记录）` : ''}`
  } catch (error) {
    message.value = `导入失败：${error instanceof Error ? error.message : '文件格式不正确'}`
  } finally {
    input.value = ''
  }
}

async function onClear() {
  if (!confirm('确定清空所有掌握状态、收藏和笔记吗？无法撤销，建议先导出备份。')) return
  await clearAll()
  message.value = '已清空'
}
</script>

<template>
  <div class="page container">
    <header class="page-head">
      <p class="eyebrow">MY PROGRESS · 我的进度</p>
      <h1 class="serif">我的进度</h1>
      <p v-if="ready && !loggedIn" class="sub">
        当前没有登录，记录只保存在这台设备的浏览器里。<NuxtLink to="/login?redirect=/progress">登录</NuxtLink>后会自动合并到账号。
      </p>
      <p v-else class="sub">掌握程度、收藏和笔记都会自动保存。没掌握的题，就从这里开始复习。</p>
    </header>

    <!-- 总览 -->
    <section class="overview">
      <div class="ring-card">
        <div class="donut">
          <svg viewBox="0 0 128 128" width="168" height="168" aria-hidden="true">
            <circle cx="64" cy="64" :r="R" class="track" />
            <circle
              v-for="seg in ring"
              :key="seg.key"
              cx="64"
              cy="64"
              :r="R"
              class="seg"
              :class="`is-${seg.key}`"
              :stroke-dasharray="seg.dash"
              :stroke-dashoffset="seg.offset"
              transform="rotate(-90 64 64)"
            />
          </svg>
          <div class="donut-center">
            <strong class="serif">{{ pct }}<small>%</small></strong>
            <span>已掌握</span>
          </div>
        </div>
        <ul class="legend">
          <li><i class="dot is-mastered" />掌握<b class="num">{{ stats.mastered }}</b></li>
          <li><i class="dot is-fuzzy" />模糊<b class="num">{{ stats.fuzzy }}</b></li>
          <li><i class="dot is-weak" />不会<b class="num">{{ stats.weak }}</b></li>
          <li><i class="dot" />未学<b class="num">{{ stats.fresh }}</b></li>
        </ul>
      </div>

      <div class="cards">
        <div class="stat review" :class="{ hot: counts.review }">
          <span class="stat-label">待复习</span>
          <strong class="serif">{{ counts.review }}</strong>
          <p>标"不会""模糊"或 AI 面试低分的题</p>
          <button type="button" class="btn btn-primary btn-sm" :disabled="!stats.total" @click="randomPick">
            {{ counts.review ? '抽一道复习' : '随机抽一题' }}
          </button>
        </div>
        <div class="stat">
          <span class="stat-label">收藏</span>
          <strong class="serif">{{ stats.star }}</strong>
          <p>想反复看的题</p>
        </div>
        <div class="stat">
          <span class="stat-label">笔记</span>
          <strong class="serif">{{ stats.note }}</strong>
          <p>用自己的话写下的复述</p>
        </div>
      </div>
    </section>

    <!-- 题目地图 -->
    <section class="map">
      <div class="section-head">
        <h2 class="serif">题目地图</h2>
        <p>每个方块是一道题，颜色表示掌握程度，点一下直接打开。</p>
      </div>
      <div class="map-parts">
        <div v-for="p in outline" :key="p.id" class="map-part">
          <h3>
            {{ p.title }}
            <span class="num">{{ partDone(p.categories.flatMap((c) => c.questions)) }}/{{ p.categories.reduce((n, c) => n + c.questions.length, 0) }}</span>
          </h3>
          <div v-for="c in p.categories" :key="c.id" class="map-row">
            <span class="map-cat">{{ c.title }}</span>
            <div class="cells">
              <NuxtLink
                v-for="q in c.questions"
                :key="q.id"
                :to="q.path"
                class="cell"
                :class="statusOf(q) && `is-${statusOf(q)}`"
                :title="cellLabel(q)"
                :aria-label="cellLabel(q)"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 题目清单 -->
    <section class="list">
      <div class="section-head">
        <h2 class="serif">复习清单</h2>
        <p>按状态筛选题目，从上往下逐个击破。</p>
      </div>
      <div class="tabs" role="tablist" aria-label="筛选题目">
        <button
          v-for="f in filters"
          :key="f.value"
          type="button"
          role="tab"
          :aria-selected="filter === f.value"
          :class="{ active: filter === f.value }"
          @click="filter = f.value"
        >
          {{ f.label }}<span class="num">{{ counts[f.value] }}</span>
        </button>
      </div>

      <div v-if="!view.length" class="empty">
        <p>{{ emptyText }}</p>
        <button v-if="stats.total" type="button" class="btn btn-sm" @click="randomPick">随机抽一题</button>
      </div>

      <div v-for="p in view" :key="p.id" class="list-part">
        <h3 class="serif">{{ p.title }}</h3>
        <div v-for="g in p.groups" :key="g.id" class="group">
          <p class="group-title">{{ g.title }}</p>
          <ul>
            <li v-for="q in g.items" :key="q.id">
              <NuxtLink :to="q.path" class="row">
                <span class="no num">{{ String(q.num).padStart(2, '0') }}</span>
                <span class="title">{{ plainTitle(q.title) }}</span>
                <span v-if="records[q.id]?.note" class="badge">笔记</span>
                <span v-if="records[q.id]?.starred" class="star" aria-label="已收藏">★</span>
                <span class="status" :class="statusOf(q) && `is-${statusOf(q)}`">
                  <i class="dot" :class="statusOf(q) && `is-${statusOf(q)}`" />{{ statusOf(q) ? STATUS_LABELS[statusOf(q)!] : '未学' }}
                </span>
              </NuxtLink>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 数据备份 -->
    <section class="backup">
      <div>
        <h2>数据备份</h2>
        <p>导出学习记录做备份；也可以导入备份文件，或旧版静态站导出的记录（需要先登录）。</p>
      </div>
      <div class="backup-actions">
        <button type="button" class="btn btn-sm" @click="onExport">导出记录</button>
        <label class="btn btn-sm" :class="{ disabled: !loggedIn }">
          导入记录
          <input type="file" accept="application/json,.json" hidden :disabled="!loggedIn" @change="onImport">
        </label>
        <button type="button" class="btn btn-sm btn-ghost danger" @click="onClear">清空记录</button>
      </div>
      <p v-if="message" class="message" role="status">{{ message }}</p>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 1040px;
  padding-top: 48px;
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

/* 总览 */
.overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: 16px;
  margin-top: 32px;
}

.ring-card,
.stat {
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
}

.ring-card {
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 24px 28px;
}

.donut {
  position: relative;
  flex: none;
}

.donut svg {
  display: block;
}

.donut circle {
  fill: none;
  stroke-width: 14;
}

.track {
  stroke: var(--c-bg-mute);
}

.seg {
  transition:
    stroke-dasharray var(--dur-slow) var(--ease),
    stroke-dashoffset var(--dur-slow) var(--ease);
}

.seg.is-mastered { stroke: var(--st-mastered); }
.seg.is-fuzzy { stroke: var(--st-fuzzy); }
.seg.is-weak { stroke: var(--st-weak); }

.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.donut-center strong {
  font-size: 36px;
  font-weight: 800;
  line-height: 1;
}

.donut-center small {
  font-size: 16px;
  font-weight: 600;
}

.donut-center span {
  margin-top: 4px;
  font-size: 12px;
  color: var(--c-text-3);
}

.legend {
  display: grid;
  flex: 1;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
  color: var(--c-text-2);
}

.legend li {
  display: flex;
  align-items: center;
  gap: 8px;
}

.legend b {
  margin-left: auto;
  color: var(--c-text-1);
}

.cards {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr;
  gap: 16px;
}

.stat {
  display: flex;
  flex-direction: column;
  padding: 20px;
}

.stat-label {
  font-size: 13px;
  color: var(--c-text-3);
}

.stat strong {
  margin-top: 6px;
  font-size: 40px;
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.stat p {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.stat .btn {
  align-self: flex-start;
  margin-top: auto;
}

.stat.review.hot strong {
  color: var(--st-weak-text);
}

.stat.review p {
  margin-bottom: 16px;
}

/* 题目地图 */
.section-head h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
}

.section-head p {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--c-text-2);
}

.map {
  margin-top: 56px;
}

.map-parts {
  display: grid;
  gap: 16px;
  margin-top: 20px;
  padding: 24px 28px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
}

.map-part + .map-part {
  padding-top: 16px;
  border-top: 1px dashed var(--c-divider);
}

.map-part h3 {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 10px;
  font-size: 15px;
}

.map-part h3 span {
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-3);
}

.map-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.map-cat {
  overflow: hidden;
  font-size: 13px;
  color: var(--c-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cells {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.cell {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--st-empty);
  transition:
    transform var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast);
}

.cell:hover,
.cell:focus-visible {
  transform: scale(1.25);
  box-shadow: 0 0 0 2px var(--c-bg-elv), 0 0 0 3px var(--c-text-1);
  outline: none;
}

.cell.is-weak { background: var(--st-weak); }
.cell.is-fuzzy { background: var(--st-fuzzy); }
.cell.is-mastered { background: var(--st-mastered); }

/* 清单 */
.list {
  margin-top: 56px;
}

.tabs {
  display: flex;
  gap: 4px;
  margin-top: 20px;
  padding: 4px;
  width: fit-content;
  max-width: 100%;
  overflow-x: auto;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
  border: 1px solid var(--c-divider);
}

.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: none;
  border-radius: 7px;
  background: none;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--c-text-2);
  cursor: pointer;
  transition:
    background-color var(--dur-fast),
    color var(--dur-fast);
}

.tabs button:hover {
  color: var(--c-text-1);
}

.tabs button.active {
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-xs);
  color: var(--c-text-1);
  font-weight: 600;
}

.tabs span {
  font-size: 12px;
  color: var(--c-text-3);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  margin: 20px 0 0;
  padding: 36px 16px;
  border: 1px dashed var(--c-border);
  border-radius: var(--r-lg);
  text-align: center;
  color: var(--c-text-2);
}

.empty p {
  margin: 0;
  max-width: 32em;
}

.list-part h3 {
  margin: 32px 0 10px;
  font-size: 20px;
  font-weight: 700;
}

.group {
  margin-bottom: 12px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  overflow: hidden;
}

.group-title {
  margin: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
  font-size: 13px;
  font-weight: 700;
}

.group ul {
  margin: 0;
  padding: 4px;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: var(--r-sm);
  font-size: 14px;
  color: var(--c-text-1);
  transition: background-color var(--dur-fast);
}

.row:hover {
  background: var(--c-default-soft);
}

.no {
  flex: none;
  width: 22px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--c-text-3);
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  padding: 1px 7px;
  border-radius: var(--r-xs);
  background: var(--c-default-soft);
  font-size: 12px;
  color: var(--c-text-2);
}

.status {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  width: 52px;
  font-size: 12px;
  color: var(--c-text-3);
}

.status.is-weak { color: var(--st-weak-text); }
.status.is-fuzzy { color: var(--st-fuzzy-text); }
.status.is-mastered { color: var(--st-mastered-text); }

/* 备份 */
.backup {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 56px;
  padding: 20px 24px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-soft);
}

.backup h2 {
  margin: 0;
  font-size: 16px;
}

.backup p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--c-text-2);
}

.backup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn.danger:hover:not(:disabled) {
  color: var(--st-weak-text);
}

.message {
  flex-basis: 100%;
}

@media (max-width: 900px) {
  .overview {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .page {
    padding-top: 32px;
  }

  .ring-card {
    flex-direction: column;
    align-items: stretch;
    padding: 20px;
  }

  .donut {
    align-self: center;
  }

  .legend {
    grid-template-columns: 1fr 1fr;
    gap: 10px 24px;
  }

  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stat.review {
    grid-column: 1 / -1;
  }

  .map-parts {
    padding: 18px 16px;
  }

  .map-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .status {
    width: auto;
  }
}
</style>
