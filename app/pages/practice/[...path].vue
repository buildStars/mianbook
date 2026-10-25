<script setup lang="ts">
import type { PracticeDetail, PracticeReviewDoneEvent, PracticeTestResult } from '#shared/types/practice'

/**
 * 默写练习：只给要求和函数签名，自己写实现，在沙箱里跑测试用例（/sandbox/runner）；
 * 全部通过（或者想看答案）之后再看参考答案，登录后可以让 AI 面试官点评代码。
 * 地址是 /practice + 题目路径，题目文件在 practice/ 下
 */
const route = useRoute()
const path = computed(() => `/${([] as string[]).concat(route.params.path ?? []).join('/')}`)
const { data } = await useFetch<PracticeDetail>(() => `/api/practice${path.value}`, { key: computed(() => `practice:${path.value}`) })
if (!data.value) throw createError({ statusCode: 404, statusMessage: '这道题还没有默写练习', fatal: true })
const p = computed(() => data.value!)

const testNames = computed(() => [...p.value.tests.matchAll(/^\s*test\(\s*(['"`])(.+?)\1/gm)].map((m) => m[2]!))

const description = computed(
  () => `在浏览器里手写${p.value.title.replace(/^手写\s*/, '')}，用 ${testNames.value.length} 个测试用例检验对不对；通过后可以看参考答案，还能让 AI 面试官点评你的代码。`,
)
useSeoMeta({
  title: () => `${p.value.title} · 默写练习`,
  description,
  ogTitle: () => `${p.value.title} · 默写练习`,
  ogDescription: description,
})

const { loggedIn } = useUserSession()
const { records, setStatus } = useStudy()
const { track } = useLearningEvents()
const progress = usePracticeProgress()
const { headersFor } = useAiKey()
const sandbox = useSandbox()

// ---- 代码和草稿 ----
const code = ref(p.value.starter)
const editor = ref<{ focus: () => void } | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(code, (value) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => progress.saveDraft(p.value.questionId, value, p.value.starter), 400)
})

function loadDraft() {
  progress.load()
  code.value = progress.readDraft(p.value.questionId) ?? p.value.starter
  resetRun()
  hintsShown.value = 0
  showTests.value = false
  solution.value = 'hidden'
}
onMounted(loadDraft)
// 上一道、下一道之间切换时页面组件不重建，重新取草稿
watch(() => p.value.questionId, loadDraft)

/** 重置要点两下：第一下变成"确定重置？"，3 秒内再点才重置 */
const confirmReset = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined
function reset() {
  if (code.value === p.value.starter) return
  if (!confirmReset.value) {
    confirmReset.value = true
    resetTimer = setTimeout(() => (confirmReset.value = false), 3000)
    return
  }
  clearTimeout(resetTimer)
  confirmReset.value = false
  code.value = p.value.starter
  resetRun()
}

// ---- 运行测试 ----
type Status = 'idle' | 'running' | 'done' | 'error' | 'timeout'
const status = ref<Status>('idle')
const results = ref<(PracticeTestResult | undefined)[]>([])
const summary = ref<{ passed: number; total: number } | null>(null)
const consoleLines = ref<{ level: string; text: string; at?: string }[]>([])
/** 代码本身有语法错误或者顶层就出错，测试一条都没跑 */
const runError = ref<{ message: string; at?: string } | null>(null)
const frameBox = ref<HTMLElement | null>(null)
const elapsed = ref(0)
const allPassed = computed(() => !!summary.value && summary.value.total > 0 && summary.value.passed === summary.value.total)
const TIMEOUT = 20_000
let codeLines = 0
let seq = 0

function resetRun() {
  sandbox.stop()
  status.value = 'idle'
  results.value = []
  summary.value = null
  consoleLines.value = []
  runError.value = null
  review.status = 'idle'
  review.text = ''
}

/** 运行页报的是整段代码的行号：前面是用户的代码，隔一行是测试代码 */
function where(line: number | null | undefined) {
  if (!line) return undefined
  if (line <= codeLines) return `你的代码第 ${line} 行`
  if (line > codeLines + 1) return `测试代码第 ${line - codeLines - 1} 行`
  return undefined
}

async function run() {
  if (status.value === 'running') return
  resetRun()
  const id = ++seq
  status.value = 'running'
  const { preparePractice } = await import('#shared/utils/code-prep')
  if (id !== seq) return
  const prepared = preparePractice(code.value, p.value.tests)
  if (!prepared.ok) {
    runError.value = { message: prepared.message, at: prepared.line ? `你的代码第 ${prepared.line} 行` : undefined }
    status.value = 'error'
    return
  }
  codeLines = code.value.split('\n').length
  await nextTick()
  if (!frameBox.value) return
  sandbox.run(
    prepared.source,
    frameBox.value,
    {
      log: (level, text) => consoleLines.value.push({ level, text }),
      error: (message, line) => {
        const text = explainRunError(message)
        consoleLines.value.push({ level: 'error', text, at: where(line) })
        // 测试还没开始就出错，说明代码在顶层就抛了异常
        if (!results.value.length && !summary.value) runError.value = { message: text, at: where(line) }
      },
      test: (r) => {
        if ('done' in r) summary.value = { passed: r.passed, total: r.total }
        else results.value[r.index] = r
      },
      idle: () => finish(),
      timeout: () => {
        status.value = 'timeout'
      },
    },
    TIMEOUT,
  )
}

function finish() {
  if (status.value !== 'running') return
  elapsed.value = sandbox.elapsed()
  sandbox.stop()
  status.value = summary.value ? 'done' : 'error'
  if (summary.value && !results.value.length && !runError.value) runError.value = { message: '没有跑任何测试' }
  if (allPassed.value) {
    const first = !progress.passed.value[p.value.questionId]
    progress.markPassed(p.value.questionId)
    if (first) track({ type: 'practice_pass', questionId: p.value.questionId })
  }
}

function stop() {
  sandbox.stop()
  if (status.value === 'running') status.value = 'timeout'
}

// ---- 提示、测试代码、参考答案 ----
const hintsShown = ref(0)
const showTests = ref(false)
/** hidden → confirm（还没通过，先确认一下）→ shown */
const solution = ref<'hidden' | 'confirm' | 'shown'>('hidden')
function revealSolution() {
  if (solution.value === 'hidden' && !allPassed.value && !progress.passed.value[p.value.questionId]) solution.value = 'confirm'
  else solution.value = 'shown'
}
const mastered = computed(() => records.value[p.value.questionId]?.status === 'mastered')

// ---- AI 点评 ----
const review = reactive({ status: 'idle' as 'idle' | 'loading' | 'done' | 'error', text: '', error: '', remaining: null as number | null })
let reviewController: AbortController | null = null
async function askReview() {
  if (!summary.value) return
  reviewController?.abort()
  reviewController = new AbortController()
  review.status = 'loading'
  review.text = ''
  review.error = ''
  const failures = results.value
    .filter((r): r is PracticeTestResult => !!r && !r.ok)
    .map((r) => ({ name: r.name, message: r.error?.message ?? '' }))
  try {
    await postSSE(
      '/api/practice/review',
      { path: p.value.path, code: code.value, passed: summary.value.passed, total: summary.value.total, failures },
      { headers: headersFor(), signal: reviewController.signal },
      (event, data) => {
        if (event === 'delta') review.text += data.text
        if (event === 'done') review.remaining = (data as PracticeReviewDoneEvent).remaining
      },
    )
    review.status = 'done'
  } catch (error) {
    if (reviewController.signal.aborted) return
    review.status = 'error'
    review.error = (error as Error).message
  }
}
onBeforeUnmount(() => reviewController?.abort())

const statusText = computed(() => {
  if (status.value === 'running') return '运行中…'
  if (status.value === 'timeout') return `超过 ${TIMEOUT / 1000} 秒还没跑完，已停止（是不是有 Promise 一直没有 resolve？）`
  if (runError.value) return '代码出错了，测试没有跑完'
  if (!summary.value) return ''
  return `通过 ${summary.value.passed} / ${summary.value.total} · 用时 ${elapsed.value < 1000 ? `${elapsed.value} 毫秒` : `${(elapsed.value / 1000).toFixed(1)} 秒`}`
})
const loginLink = computed(() => `/login?redirect=${encodeURIComponent(route.fullPath)}`)
</script>

<template>
  <div class="page container">
    <nav class="crumbs" aria-label="面包屑">
      <NuxtLink to="/practice" class="tap">默写练习</NuxtLink>
      <span aria-hidden="true">/</span>
      <NuxtLink :to="`/${p.path.split('/')[1]}/${p.category.slug}`" class="tap">{{ p.category.title }}</NuxtLink>
      <span aria-hidden="true">/</span>
      <span aria-current="page">No.{{ String(p.num).padStart(2, '0') }}</span>
    </nav>

    <header class="head">
      <div>
        <p class="eyebrow">默写练习 · {{ p.category.title }}</p>
        <h1 class="serif">{{ p.title }}</h1>
      </div>
      <div class="head-meta">
        <DifficultyBadge :value="p.difficulty" />
        <ClientOnly>
          <span v-if="progress.passed.value[p.questionId]" class="passed-tag">✓ 通过过</span>
        </ClientOnly>
        <NuxtLink :to="p.path" class="head-link">看题目讲解 →</NuxtLink>
      </div>
    </header>

    <div class="layout">
      <section class="task card" aria-labelledby="task-title">
        <h2 id="task-title" class="section-title">要求</h2>
        <!-- 要求来自仓库里的练习文件，渲染时关闭了原始 HTML -->
        <div class="doc-content task-body" v-html="p.taskHtml" />

        <div v-if="p.hints.length" class="hints">
          <ol v-if="hintsShown" class="hint-list">
            <!-- 提示也来自练习文件，服务端已经转义 -->
            <li v-for="(h, i) in p.hints.slice(0, hintsShown)" :key="i" v-html="h" />
          </ol>
          <button v-if="hintsShown < p.hints.length" type="button" class="btn btn-ghost btn-sm" @click="hintsShown++">
            {{ hintsShown ? `再给一条提示（还有 ${p.hints.length - hintsShown} 条）` : `卡住了？看提示（共 ${p.hints.length} 条）` }}
          </button>
        </div>
      </section>

      <section class="work" aria-label="写代码和运行测试">
        <div class="editor-card">
          <div class="editor-head">
            <span class="editor-title">你的代码</span>
            <span class="spacer" />
            <span v-if="status === 'error' || status === 'timeout'" class="head-result bad">出错</span>
            <span v-else-if="summary" class="head-result" :class="allPassed ? 'ok' : 'bad'" :aria-label="`通过 ${summary.passed} / ${summary.total}`">
              {{ allPassed ? '✓' : '✕' }} {{ summary.passed }}/{{ summary.total }}
            </span>
            <span v-else class="kbd-hint editor-keys">Ctrl + Enter 运行</span>
            <button type="button" class="tool" :disabled="code === p.starter" @click="reset">
              {{ confirmReset ? '确定重置？' : '重置' }}
            </button>
            <button v-if="status === 'running'" type="button" class="tool run running" @click="stop">停止</button>
            <button v-else type="button" class="tool run" @click="run">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" /></svg>
              运行测试
            </button>
          </div>
          <div class="editor-body">
            <PracticeCodeEditor ref="editor" v-model="code" @run="run" />
          </div>
          <p class="editor-foot">代码自动保存在这台设备上，下次打开接着写</p>
        </div>

        <div class="results card" aria-live="polite">
          <div class="results-head">
            <h2 class="section-title">测试用例</h2>
            <span class="status" :class="[status, { ok: allPassed }]">{{ statusText }}</span>
          </div>
          <div v-if="summary" class="bar" aria-hidden="true">
            <i :style="{ width: `${(summary.passed / Math.max(summary.total, 1)) * 100}%` }" :class="{ ok: allPassed }" />
          </div>
          <p v-if="runError" class="run-error">
            {{ runError.message }}<span v-if="runError.at" class="at">{{ runError.at }}</span>
          </p>
          <ol class="tests">
            <li v-for="(name, i) in testNames" :key="i" :class="results[i] ? (results[i]!.ok ? 'pass' : 'fail') : 'pending'">
              <span class="mark" :aria-label="results[i] ? (results[i]!.ok ? '通过' : '没通过') : '还没运行'">
                {{ results[i] ? (results[i]!.ok ? '✓' : '✕') : '○' }}
              </span>
              <span class="test-main">
                <span class="test-name">{{ name }}</span>
                <span v-if="results[i] && !results[i]!.ok && results[i]!.error" class="test-error">
                  {{ explainRunError(results[i]!.error!.message) }}<span v-if="where(results[i]!.error!.line)" class="at">{{ where(results[i]!.error!.line) }}</span>
                </span>
              </span>
              <span v-if="results[i]" class="test-ms num">{{ results[i]!.ms }}ms</span>
            </li>
          </ol>

          <div v-if="consoleLines.length" class="console">
            <p class="console-title">控制台</p>
            <ol>
              <li v-for="(l, i) in consoleLines.slice(0, 200)" :key="i" :class="l.level">
                {{ l.text }}<span v-if="l.at" class="at">{{ l.at }}</span>
              </li>
            </ol>
          </div>
          <div ref="frameBox" class="frame-box" />
        </div>

        <div v-if="allPassed" class="done card">
          <p class="done-title serif">全部通过 🎉</p>
          <p class="done-text">面试时能这样一次写对就稳了。可以对照参考答案看看写法上的差别，或者让 AI 面试官挑挑刺。</p>
          <div class="done-actions">
            <button v-if="!mastered" type="button" class="btn btn-primary btn-sm" @click="setStatus(p.questionId, 'mastered')">标记这道题为"掌握"</button>
            <span v-else class="mastered">✓ 已标记为掌握</span>
            <NuxtLink v-if="p.next" :to="`/practice${p.next.path}`" class="btn btn-sm">下一道：{{ p.next.title }} →</NuxtLink>
          </div>
        </div>

        <div v-if="summary" class="review card ai-border">
          <div class="review-head">
            <p class="review-title ai-text">AI 面试官点评</p>
            <template v-if="loggedIn">
              <button v-if="review.status !== 'loading'" type="button" class="btn btn-ai btn-sm" @click="askReview">
                {{ review.status === 'done' ? '重新点评' : allPassed ? '让 AI 点评我的代码' : '让 AI 帮我看看哪里不对' }}
              </button>
              <span v-else class="review-loading">正在看你的代码…</span>
            </template>
            <NuxtLink v-else :to="loginLink" class="btn btn-sm">登录后让 AI 点评</NuxtLink>
          </div>
          <p v-if="review.status === 'idle'" class="review-tip">对照要求和参考答案，指出问题、边界情况和面试官可能的追问。占用一次 AI 次数。</p>
          <!-- 大模型的输出用 renderAiMarkdown 渲染：转义原始 HTML、禁用图片 -->
          <div v-if="review.text" class="review-body" v-html="renderAiMarkdown(review.text)" />
          <p v-if="review.status === 'error'" class="run-error">{{ review.error }}</p>
          <p v-if="review.status === 'done' && review.remaining !== null" class="review-tip">24 小时内还可以用 {{ review.remaining }} 次</p>
        </div>
      </section>

      <section class="extra card" aria-label="测试代码和参考答案">
        <button type="button" class="fold" :aria-expanded="showTests" @click="showTests = !showTests">
          <span>测试代码</span><span class="fold-hint">{{ showTests ? '收起' : '看看测试具体测了什么' }}</span>
        </button>
        <div v-if="showTests" class="code-view">
          <PracticeCodeEditor :model-value="p.tests" readonly label="测试代码" />
        </div>

        <div class="solution">
          <button v-if="solution !== 'shown'" type="button" class="fold" @click="revealSolution">
            <span>参考答案</span><span class="fold-hint">{{ allPassed ? '对照一下写法' : '先自己写，实在写不出来再看' }}</span>
          </button>
          <div v-if="solution === 'confirm'" class="confirm">
            <p>还没通过测试，现在看答案就少了一次默写的机会。确定要看吗？</p>
            <button type="button" class="btn btn-sm" @click="solution = 'shown'">看答案</button>
            <button type="button" class="btn btn-ghost btn-sm" @click="solution = 'hidden'">再想想</button>
          </div>
          <template v-if="solution === 'shown'">
            <p class="fold static"><span>参考答案</span></p>
            <div class="code-view">
              <PracticeCodeEditor :model-value="p.solution" readonly label="参考答案" />
            </div>
          </template>
        </div>
      </section>
    </div>

    <nav class="pager" aria-label="上一道、下一道">
      <NuxtLink v-if="p.prev" :to="`/practice${p.prev.path}`" class="pager-link">← {{ p.prev.title }}</NuxtLink>
      <NuxtLink to="/practice" class="pager-all">全部默写练习</NuxtLink>
      <NuxtLink v-if="p.next" :to="`/practice${p.next.path}`" class="pager-link next">{{ p.next.title }} →</NuxtLink>
    </nav>
  </div>
</template>

<style scoped>
.page {
  padding-top: 28px;
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

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 24px;
  margin-top: 18px;
}

.head h1 {
  margin: 8px 0 0;
  font-size: clamp(28px, 3.6vw, 38px);
  font-weight: 800;
  line-height: 1.25;
}

.head-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  font-size: 14px;
}

.passed-tag {
  padding: 2px 10px;
  border-radius: var(--r-full);
  background: var(--c-success-soft);
  font-size: 13px;
  font-weight: 600;
  color: var(--st-mastered-text);
}

.head-link {
  font-weight: 600;
  color: var(--c-brand);
}

.layout {
  display: grid;
  grid-template-areas:
    'task work'
    'extra work';
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  grid-template-rows: auto 1fr;
  gap: 20px 24px;
  margin-top: 24px;
}

.task {
  grid-area: task;
}

.work {
  display: flex;
  flex-direction: column;
  grid-area: work;
  gap: 16px;
  min-width: 0;
}

.extra {
  grid-area: extra;
  align-self: start;
}

.card {
  padding: 20px 22px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
}

.section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--c-text-3);
}

.task-body {
  margin-top: 10px;
  font-size: 15px;
  line-height: 1.8;
}

.hints {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed var(--c-divider);
}

.hint-list {
  margin: 0 0 10px;
  padding-left: 1.4em;
  font-size: 14px;
  line-height: 1.8;
  color: var(--c-text-2);
}

.hint-list li + li {
  margin-top: 6px;
}

.hint-list :deep(code) {
  padding: 1px 5px;
  border-radius: var(--r-xs);
  background: var(--code-inline-bg);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

/* 编辑器：深色窗口，和正文代码块一样 */
.editor-card {
  overflow: hidden;
  border: 1px solid var(--code-border);
  border-radius: var(--r-lg);
  background: var(--code-bg);
  box-shadow: var(--shadow-sm);
}

.editor-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid var(--code-border);
  background: var(--code-head);
}

.editor-title {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--code-muted);
}

.spacer {
  flex: 1;
}

.editor-keys {
  margin-right: 4px;
  font-size: 12px;
  color: var(--code-muted);
}

.tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: none;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  color: var(--code-muted);
  cursor: pointer;
}

.tool:hover:not(:disabled) {
  border-color: var(--code-border);
  color: var(--code-text);
}

.tool:disabled {
  opacity: 0.45;
  cursor: default;
}

.tool.run {
  border-color: rgba(61, 207, 142, 0.4);
  background: rgba(61, 207, 142, 0.14);
  font-weight: 600;
  color: #3dcf8e;
}

.tool.run:hover {
  background: rgba(61, 207, 142, 0.22);
  color: #5fe0a6;
}

.tool.run.running {
  border-color: rgba(255, 123, 114, 0.4);
  background: rgba(255, 123, 114, 0.12);
  color: #ff7b72;
}

.editor-body {
  height: clamp(280px, 46vh, 560px);
}

.head-result {
  margin-right: 4px;
  padding: 2px 9px;
  border-radius: var(--r-full);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
}

.head-result.ok {
  background: rgba(61, 207, 142, 0.16);
  color: #3dcf8e;
}

.head-result.bad {
  background: rgba(255, 123, 114, 0.14);
  color: #ff7b72;
}

.editor-foot {
  margin: 0;
  padding: 8px 16px;
  border-top: 1px solid var(--code-border);
  font-size: 12px;
  color: var(--code-muted);
}

.results-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 16px;
}

.status {
  font-size: 13px;
  color: var(--c-text-2);
}

.status.running {
  color: var(--c-brand);
}

.status.done:not(.ok),
.status.error,
.status.timeout {
  color: var(--st-weak-text);
}

.status.ok {
  font-weight: 600;
  color: var(--st-mastered-text);
}

.bar {
  height: 6px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--c-danger-soft);
}

.bar i {
  display: block;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--st-fuzzy);
  transition: width var(--dur-slow) var(--ease);
}

.bar i.ok {
  background: var(--st-mastered);
}

.run-error {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--c-danger-soft);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--c-danger);
}

.at {
  margin-left: 10px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--c-text-3);
  white-space: nowrap;
}

.tests {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.tests li {
  display: flex;
  gap: 10px;
  padding: 9px 2px;
  font-size: 14px;
  line-height: 1.6;
}

.tests li + li {
  border-top: 1px solid var(--c-divider);
}

.mark {
  flex: none;
  width: 18px;
  font-weight: 700;
  text-align: center;
  color: var(--c-text-3);
}

.pass .mark {
  color: var(--st-mastered-text);
}

.fail .mark {
  color: var(--st-weak-text);
}

.test-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.pending .test-name {
  color: var(--c-text-2);
}

.test-error {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--st-weak-text);
}

.test-ms {
  flex: none;
  font-size: 12px;
  color: var(--c-text-3);
}

.console {
  margin-top: 14px;
  padding: 10px 0;
  border-radius: var(--r-md);
  background: var(--code-bg);
}

.console-title {
  margin: 0 14px 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--code-muted);
}

.console ol {
  max-height: 240px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.7;
}

.console li {
  padding: 1px 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--code-text);
}

.console li.warn {
  color: #e3b341;
}

.console li.error {
  color: #ff7b72;
}

.console li.info {
  color: #79c0ff;
}

.console .at {
  color: var(--code-muted);
}

/* 运行用的 iframe 放在屏幕外（练习不需要页面预览） */
.frame-box {
  position: fixed;
  top: 0;
  left: -10000px;
  width: 640px;
  height: 320px;
  visibility: hidden;
  pointer-events: none;
}

.frame-box :deep(.code-frame) {
  width: 100%;
  height: 100%;
  border: 0;
}

.done {
  border-color: color-mix(in srgb, var(--st-mastered) 40%, transparent);
  background: var(--c-success-soft);
}

.done-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--st-mastered-text);
}

.done-text {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.done-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.mastered {
  font-size: 14px;
  font-weight: 600;
  color: var(--st-mastered-text);
}

.review-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.review-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.review-loading,
.review-tip {
  font-size: 13px;
  color: var(--c-text-3);
}

.review-tip {
  margin: 8px 0 0;
}

.review-body {
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.8;
}

.review-body :deep(h3) {
  margin: 14px 0 4px;
  font-size: 15px;
}

.review-body :deep(h3:first-child) {
  margin-top: 0;
}

.review-body :deep(ul) {
  margin: 4px 0;
  padding-left: 1.3em;
}

.review-body :deep(code) {
  padding: 1px 5px;
  border-radius: var(--r-xs);
  background: var(--code-inline-bg);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.fold {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  margin: 0;
  padding: 4px 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  text-align: left;
  color: var(--c-text-1);
  cursor: pointer;
}

.fold.static {
  cursor: default;
}

.fold-hint {
  font-size: 13px;
  font-weight: 400;
  color: var(--c-brand);
}

.solution {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--c-divider);
}

.confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--c-warning-soft);
}

.confirm p {
  flex-basis: 100%;
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--c-text-1);
}

.code-view {
  max-height: 520px;
  margin-top: 10px;
  overflow: auto;
  border-radius: var(--r-md);
  background: var(--code-bg);
}

.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 40px;
  padding-top: 20px;
  border-top: 1px solid var(--c-divider);
  font-size: 14px;
}

.pager-link {
  color: var(--c-text-1);
}

.pager-link:hover,
.pager-all:hover {
  color: var(--c-brand);
}

.pager-all {
  color: var(--c-text-2);
}

.pager-link.next {
  margin-left: auto;
  text-align: right;
}

@media (max-width: 960px) {
  .layout {
    grid-template-areas:
      'task'
      'work'
      'extra';
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
  }

  .editor-body {
    height: 420px;
  }
}

@media (max-width: 640px) {
  .card {
    padding: 16px;
  }

  .editor-body {
    height: 300px;
  }

  .pager-all {
    order: 3;
    flex-basis: 100%;
    text-align: center;
  }
}
</style>
