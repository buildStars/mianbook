<script setup lang="ts">
import type { AskDoneEvent, AskSourceView, AskSourcesEvent } from '#shared/types/ask'

const seoTitle = '问手册：AI 根据题库回答面试问题'
const seoDescription = '用自己的话问面试问题：先从面书题库里找出相关段落，再由 AI 根据这些段落回答，每句话都标出处，点编号就能看原题。'
useSeoMeta({ title: seoTitle, description: seoDescription, ogTitle: seoTitle, ogDescription: seoDescription })

interface AiStatus {
  enabled: boolean
  remaining: number
  dailyLimit: number
  extraHosts: string[]
  allowUserKey: boolean
}

interface AskTurnView {
  id: number
  question: string
  answer: string
  sources: AskSourceView[]
  citations: number[]
  /** searching：检索中；answering：回答中；done / error：结束 */
  phase: 'searching' | 'answering' | 'done' | 'error'
  error: string
}

const EXAMPLES = [
  '缓存击穿和缓存雪崩有什么区别？',
  'useEffect 的依赖数组怎么写才不会死循环？',
  'RAG 的召回效果怎么评估？',
  'Go 的 GMP 调度模型是什么？',
  '大模型流式输出部署到 Nginx 后面为什么不流了？',
]

const route = useRoute()
const router = useRouter()
const { loggedIn } = useUserSession()
const { all } = useOutline()
const { data: ai, refresh: refreshAi } = useFetch<AiStatus>('/api/ai/status', { key: 'ai-status' })
const { hasKey: hasStoredKey, headersFor } = useAiKey()
const hasKey = computed(() => hasStoredKey.value && ai.value?.allowUserKey !== false)
const allowOwnKey = computed(() => ai.value?.allowUserKey !== false)
const canUse = computed(() => hasKey.value || Boolean(ai.value?.enabled))
const showSettings = ref(false)

/** 没登录时展示的示例问答：引用的是题库里真实的题，点编号就能看原题；题目不存在时那条引用自动去掉 */
const DEMO_SOURCES = [
  {
    path: '/basics/javascript/01-event-loop',
    snippet: '每一轮循环先执行一个宏任务，执行完后清空所有微任务，然后浏览器视情况渲染页面，再取下一个宏任务。',
  },
  {
    path: '/basics/node/01-event-loop',
    snippet: '同步代码最先执行；之后先清空 process.nextTick 队列，再清空 Promise 微任务队列；然后进入事件循环的各个阶段。',
  },
]
const demoTurn = computed<AskTurnView>(() => {
  const sources = DEMO_SOURCES.flatMap((s, i) => {
    const q = all.value.find((x) => x.path === s.path)
    return q ? [{ n: i + 1, questionId: q.id, title: q.title, path: q.path, category: q.categoryTitle, heading: '一句话回答', snippet: s.snippet }] : []
  })
  return {
    id: 0,
    question: 'Promise.then 和 setTimeout 谁先执行？Node.js 里也一样吗？',
    answer:
      '浏览器里每轮事件循环先执行一个宏任务，执行完立刻清空所有微任务，再视情况渲染、进入下一轮 [1]。所以在同一段同步代码里注册的 `Promise.then` 回调（微任务）会比 `setTimeout` 回调（宏任务）先执行 [1]。\n\n' +
      'Node.js 里同样是同步代码跑完后先清空微任务，区别是 `process.nextTick` 队列比 Promise 微任务还要早；`setTimeout` 在 timers 阶段执行，`setImmediate` 在 check 阶段执行 [2]。',
    sources,
    citations: sources.map((s) => s.n),
    phase: 'done',
    error: '',
  }
})

// 对话存在 useState 里：点引用去看原题，再返回时对话还在（刷新页面会清空，不存数据库）
const turns = useState<AskTurnView[]>('ask-turns', () => [])
const input = ref('')
const remaining = ref<number | null>(null)
/** 没登录、还没问过时先展示示例 */
const shownTurns = computed(() => (!loggedIn.value && !turns.value.length ? [demoTurn.value] : turns.value))
const busy = computed(() => turns.value.some((t) => t.phase === 'searching' || t.phase === 'answering'))
const textarea = ref<HTMLTextAreaElement>()
const list = ref<HTMLElement>()
let controller: AbortController | null = null
let nextId = Date.now()

watch(loggedIn, () => refreshAi())
onBeforeUnmount(() => controller?.abort())

/** 之前已经答完的几轮，作为上下文发给服务端 */
function historyFor(turn: AskTurnView) {
  return turns.value
    .filter((t) => t.id !== turn.id && t.phase === 'done' && t.sources.length)
    .slice(-3)
    .flatMap((t) => [
      { role: 'user' as const, content: t.question },
      { role: 'assistant' as const, content: t.answer },
    ])
}

async function ask(text = input.value) {
  const question = text.trim()
  if (question.length < 2 || busy.value) return
  // 没登录时先去注册，回来按 ?q= 自动接着问（见下面的 onMounted）
  if (!loggedIn.value) return navigateTo({ path: '/register', query: { redirect: `/ask?q=${encodeURIComponent(question)}` } })
  input.value = ''
  const turn = reactive<AskTurnView>({ id: nextId++, question, answer: '', sources: [], citations: [], phase: 'searching', error: '' })
  turns.value.push(turn)
  await nextTick()
  list.value?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  controller = new AbortController()
  try {
    await postSSE('/api/ask', { question, history: historyFor(turn) }, { headers: headersFor(), signal: controller.signal }, (event, data) => {
      if (event === 'sources') {
        turn.sources = (data as AskSourcesEvent).sources
        turn.phase = 'answering'
      } else if (event === 'delta') {
        turn.answer += data.text
      } else if (event === 'done') {
        const done = data as AskDoneEvent
        turn.citations = done.citations
        remaining.value = done.remaining
        turn.phase = 'done'
      }
    })
    if (turn.phase !== 'done') turn.phase = 'done'
  } catch (error) {
    if (controller.signal.aborted) {
      turn.phase = 'done'
      if (!turn.answer) turn.answer = '已停止。'
    } else {
      turn.phase = 'error'
      turn.error = error instanceof Error ? error.message : '出错了，请稍后再试'
    }
  } finally {
    controller = null
  }
}

function stop() {
  controller?.abort()
}

function retry(turn: AskTurnView) {
  turns.value = turns.value.filter((t) => t.id !== turn.id)
  ask(turn.question)
}

function clearAll() {
  stop()
  turns.value = []
  nextTick(() => textarea.value?.focus())
}

function onKeydown(e: KeyboardEvent) {
  // 输入法组字时的回车是确认候选词，不发送
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    ask()
  }
}

// 从搜索框"问手册"跳过来时带着 ?q=，直接提问
onMounted(() => {
  const q = typeof route.query.q === 'string' ? route.query.q : ''
  if (!q) return
  router.replace({ query: {} })
  if (loggedIn.value && canUse.value) ask(q)
  else input.value = q
})

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** 把回答里的 [n] 换成指向原题的小链接；代码块里的不动 */
function renderAnswer(turn: AskTurnView): string {
  const html = renderAiMarkdown(turn.answer)
  const byN = new Map(turn.sources.map((s) => [s.n, s]))
  return html
    .split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/\[(\d{1,2})\]/g, (_m, n: string) => {
            const s = byN.get(Number(n))
            // 模型偶尔会编出不存在的编号，直接去掉
            return s ? `<a class="cite" href="${escapeAttr(s.path)}" title="${escapeAttr(`${s.title} · ${s.heading}`)}">${n}</a>` : ''
          }),
    )
    .join('')
}

/** 资料按题目分组（同一道题可能有两段），引用过的题排在前面 */
function sourceGroups(turn: AskTurnView) {
  const cited = new Set(turn.citations)
  const groups = new Map<number, { questionId: number; title: string; path: string; category: string; cited: boolean; items: AskSourceView[] }>()
  for (const s of turn.sources) {
    const g = groups.get(s.questionId) ?? { questionId: s.questionId, title: s.title, path: s.path, category: s.category, cited: false, items: [] }
    g.items.push(s)
    g.cited ||= cited.has(s.n)
    groups.set(s.questionId, g)
  }
  return [...groups.values()].sort((a, b) => Number(b.cited) - Number(a.cited) || a.items[0]!.n - b.items[0]!.n)
}

/** 点回答里的引用：站内跳转，不整页刷新，返回时对话还在 */
function onAnswerClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a.cite') as HTMLAnchorElement | null
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return
  e.preventDefault()
  navigateTo(a.getAttribute('href')!)
}
</script>

<template>
  <div class="page container">
    <header class="page-head">
      <p class="eyebrow">ASK THE HANDBOOK · 问手册</p>
      <h1 class="serif">问手册</h1>
      <p class="sub">
        用自己的话提问。先从手册的 {{ all.length || '几百' }} 道题里找出相关段落，再由 AI 根据这些段落回答，每句话都标出处，点编号就能看原题。
      </p>
    </header>

    <!-- 没登录也能看示例、输入问题，提问时再去注册 -->
    <div v-if="loggedIn && !canUse" class="notice card">
      <p>站点还没有配置 AI 服务{{ allowOwnKey ? '，可以填写你自己的 API Key 使用' : '' }}。</p>
      <button v-if="allowOwnKey" type="button" class="btn btn-ai" @click="showSettings = true">填写我的 Key</button>
    </div>
    <InterviewAiSettings v-if="showSettings" class="settings" :extra-hosts="ai?.extraHosts ?? []" @close="showSettings = false" @saved="showSettings = false" />

    <section v-if="!turns.length" class="examples" aria-label="示例问题">
      <p class="examples-label">可以这样问</p>
      <div class="examples-list">
        <button v-for="q in EXAMPLES" :key="q" type="button" class="example" :disabled="loggedIn && !canUse" @click="ask(q)">{{ q }}</button>
      </div>
    </section>

    <ol ref="list" class="turns">
      <li v-for="turn in shownTurns" :key="turn.id" class="turn">
        <p class="question"><span class="who">{{ turn.id === 0 ? '示例' : '你问' }}</span>{{ turn.question }}</p>

        <article class="answer card ai-border" :aria-busy="turn.phase === 'searching' || turn.phase === 'answering'">
          <div class="answer-head">
            <span class="ai-text who">手册助手</span>
            <span v-if="turn.phase === 'searching'" class="status">正在检索手册<span class="dots"><i /><i /><i /></span></span>
            <span v-else-if="turn.phase === 'answering'" class="status">找到 {{ turn.sources.length }} 段资料，正在回答<span class="dots"><i /><i /><i /></span></span>
          </div>
          <p v-if="turn.phase === 'error'" class="error" role="alert">
            {{ turn.error }}
            <button type="button" class="btn btn-sm" @click="retry(turn)">重试</button>
          </p>
          <!-- 已转义原始 HTML 并禁用图片，见 renderAiMarkdown；引用链接只指向检索到的站内题目 -->
          <div v-if="turn.answer" class="body" @click="onAnswerClick" v-html="renderAnswer(turn)" />

          <details v-if="turn.sources.length" class="sources" :open="turn.phase !== 'answering'">
            <summary>
              参考了 {{ turn.sources.length }} 段手册内容<template v-if="turn.phase === 'done'">，引用了 {{ turn.citations.length }} 段</template>
            </summary>
            <ul>
              <li v-for="g in sourceGroups(turn)" :key="g.questionId" class="group" :class="{ dim: turn.phase === 'done' && !g.cited }">
                <NuxtLink :to="g.path" class="src-title tap"><RichTitle :title="g.title" /></NuxtLink>
                <span class="src-meta">{{ g.category }}</span>
                <div v-for="s in g.items" :key="s.n" class="src">
                  <span class="n num" :class="{ on: turn.citations.includes(s.n) }">{{ s.n }}</span>
                  <p class="src-snippet"><b>{{ s.heading }}</b>{{ s.snippet }}</p>
                </div>
              </li>
            </ul>
          </details>
        </article>
      </li>
    </ol>

    <div v-if="!loggedIn" class="signup card">
      <p>
        注册后就能提问<template v-if="ai?.enabled">，每天 <b>{{ ai.dailyLimit }}</b> 次免费</template>。回答只依据手册内容，每句话标出处；支持连续追问。
      </p>
      <SignupPrompt ai label="免费注册，开始提问" redirect="/ask" />
    </div>

    <form class="composer card" @submit.prevent="ask()">
      <textarea
        ref="textarea"
        v-model="input"
        rows="2"
        maxlength="500"
        :disabled="loggedIn && !canUse"
        :placeholder="turns.length ? '继续追问，比如：那它有什么缺点？' : '输入你的问题，比如：Redis 为什么这么快？'"
        aria-label="问题"
        @keydown="onKeydown"
      />
      <div class="composer-bar">
        <span class="hint">
          <template v-if="!loggedIn">提问前需要先注册，问题会带过去</template>
          <template v-else-if="hasKey">使用你自己的 Key</template>
          <template v-else-if="remaining !== null">24 小时内还可以问 {{ remaining }} 次</template>
          <span v-else class="kbd-hint">Enter 发送，Shift + Enter 换行</span>
        </span>
        <div class="actions">
          <button v-if="turns.length && !busy" type="button" class="btn btn-sm btn-ghost" @click="clearAll">清空对话</button>
          <button v-if="busy" type="button" class="btn btn-sm" @click="stop">停止</button>
          <button v-else type="submit" class="btn btn-sm btn-ai" :disabled="(loggedIn && !canUse) || input.trim().length < 2">
            {{ loggedIn ? '提问' : '注册后提问' }}
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.page {
  max-width: 820px;
  padding-top: 48px;
  padding-bottom: 80px;
}

.page-head h1 {
  margin: 10px 0 0;
  font-size: clamp(32px, 4vw, 44px);
  font-weight: 800;
}

.sub {
  max-width: 640px;
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

/* 没登录时示例下面的注册提示 */
.signup {
  display: grid;
  gap: 14px;
  margin-top: 20px;
  padding: 20px 24px;
  background: var(--ai-soft), var(--c-bg-elv);
}

.signup p {
  margin: 0;
  color: var(--c-text-2);
}

.signup b {
  color: var(--c-text-1);
}

.settings {
  margin-top: 16px;
}

.examples {
  margin-top: 32px;
}

.examples-label {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--c-text-3);
}

.examples-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.example {
  padding: 8px 14px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-full);
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.example:hover:not(:disabled) {
  border-color: var(--ai-via);
  background: var(--ai-soft);
}

.example:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.turns {
  display: flex;
  flex-direction: column;
  gap: 28px;
  margin: 32px 0 0;
  padding: 0;
  list-style: none;
}

.turn {
  scroll-margin-top: 88px;
}

.question {
  display: flex;
  gap: 10px;
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.6;
}

.who {
  flex: none;
  padding-top: 3px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--c-text-3);
}

.answer {
  padding: 16px 20px 18px;
}

.answer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 20px;
}

.answer-head .who {
  padding: 0;
  color: var(--ai-text);
}

.status {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.dots {
  display: inline-flex;
  gap: 3px;
  margin-left: 4px;
}

.dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  animation: blink 1.2s infinite ease-in-out;
}

.dots i:nth-child(2) {
  animation-delay: 0.2s;
}

.dots i:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }

  40% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dots i {
    animation: none;
    opacity: 0.6;
  }
}

.error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 10px 0 0;
  font-size: 14px;
  color: var(--c-danger);
}

.body {
  margin-top: 8px;
  font-size: 15px;
  line-height: 1.85;
  overflow-wrap: anywhere;
}

.body :deep(p),
.body :deep(ul),
.body :deep(ol) {
  margin: 6px 0;
}

.body :deep(ul),
.body :deep(ol) {
  padding-left: 1.3em;
}

.body :deep(ul) {
  list-style: disc;
}

.body :deep(ol) {
  list-style: decimal;
}

.body :deep(pre) {
  margin: 10px 0;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
  font-size: 13px;
  overflow-x: auto;
}

.body :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.body :deep(.cite) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  margin: 0 1px;
  padding: 0 4px;
  border-radius: var(--r-sm);
  background: var(--c-brand-soft);
  color: var(--c-brand);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  vertical-align: 2px;
  text-decoration: none;
}

/* 编号嵌在句子里不好放大，触屏设备上用透明的伪元素把点按区域扩到 30px 左右 */
@media (pointer: coarse) {
  .body :deep(.cite) {
    position: relative;
  }

  .body :deep(.cite)::after {
    content: '';
    position: absolute;
    inset: -6px -5px;
  }

  .sources summary {
    padding: 10px 0;
  }
}

.body :deep(.cite:hover) {
  background: var(--c-brand);
  color: #fff;
}

.sources {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--c-divider);
}

.sources summary {
  font-size: 13px;
  color: var(--c-text-2);
  cursor: pointer;
}

.sources ul {
  display: grid;
  gap: 14px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.group.dim {
  opacity: 0.6;
}

.src-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-1);
}

.src-title:hover {
  color: var(--c-brand);
}

.src-meta {
  font-size: 12px;
  color: var(--c-text-3);
}

.src {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.n {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: var(--r-sm);
  background: var(--c-default-soft);
  color: var(--c-text-3);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

.n.on {
  background: var(--c-brand-soft);
  color: var(--c-brand);
}

.src-snippet {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--c-text-2);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.src-snippet b {
  margin-right: 6px;
  font-weight: 600;
  color: var(--c-text-1);
}

.composer {
  position: sticky;
  bottom: 16px;
  z-index: 5;
  margin-top: 28px;
  padding: 12px 14px 10px;
  box-shadow: var(--shadow-md);
}

/* 吸底时，上方滚过去的内容渐隐成纸色，下方留一条纸色，输入框不会和回答卡片的边框叠在一起 */
.composer::before,
.composer::after {
  content: '';
  position: absolute;
  right: -12px;
  left: -12px;
  z-index: -1;
  pointer-events: none;
}

.composer::before {
  bottom: 100%;
  height: 36px;
  background: linear-gradient(to bottom, color-mix(in srgb, var(--c-bg) 0%, transparent), var(--c-bg));
}

.composer::after {
  top: calc(100% + 1px);
  height: 16px;
  background: var(--c-bg);
}

.composer textarea {
  display: block;
  width: 100%;
  min-height: 52px;
  max-height: 200px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--c-text-1);
  font: inherit;
  font-size: 15px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}

.composer textarea::placeholder {
  color: var(--c-text-3);
}

.composer:focus-within {
  border-color: var(--ai-via);
}

.composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
}

.hint {
  font-size: 12px;
  color: var(--c-text-3);
}

.actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 959px) {
  /* 手机底部有标签栏 */
  .composer {
    bottom: calc(68px + env(safe-area-inset-bottom));
  }
}

@media (max-width: 640px) {
  .page {
    padding-top: 28px;
  }

  .answer {
    padding: 14px 14px 16px;
  }

  .hint {
    display: none;
  }

  .composer-bar {
    justify-content: flex-end;
  }
}
</style>
