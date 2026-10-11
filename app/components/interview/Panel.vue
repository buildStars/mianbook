<script setup lang="ts">
import type { InterviewSummary, InterviewTurn, QuestionDetail, StudyStatus } from '#shared/types/handbook'

const props = defineProps<{ question: QuestionDetail }>()

interface AiStatus {
  enabled: boolean
  model: string
  dailyLimit: number
  remaining: number
  extraHosts: string[]
}

const MAX_ROUNDS = 3

const route = useRoute()
const { loggedIn, user } = useUserSession()
const { records, setStatus } = useStudy()
const { data: ai, refresh: refreshAi } = useFetch<AiStatus>('/api/ai/status', { key: 'ai-status' })
const { config: aiKey, hasKey, headersFor } = useAiKey()
const showSettings = ref(false)
/** 站点配了 Key，或者用户填了自己的 Key，都可以面试 */
const canUse = computed(() => hasKey.value || Boolean(ai.value?.enabled))
/** 用站点 Key 时受每日次数限制 */
const outOfQuota = computed(() => !hasKey.value && ai.value?.enabled && !ai.value.remaining)

const started = ref(false)
const interviewId = ref<number | null>(null)
const turns = ref<InterviewTurn[]>([])
const answer = ref('')
const pendingAnswer = ref('')
const streaming = ref(false)
const streamText = ref('')
const errorMsg = ref('')
const history = ref<InterviewSummary[]>([])
const expanded = ref<number | null>(null)
const root = ref<HTMLElement>()
const textarea = ref<HTMLTextAreaElement>()
let controller: AbortController | null = null

const finished = computed(
  () => turns.value.length >= MAX_ROUNDS || (turns.value.length > 0 && !turns.value.at(-1)!.followUp),
)
const askedAt = (i: number) => (i === 0 ? plainTitle(props.question.title) : (turns.value[i - 1]?.followUp ?? ''))
const currentQuestion = computed(() => askedAt(turns.value.length))
const average = computed(() => {
  const scores = turns.value.map((t) => t.score).filter((s): s is number => s !== null)
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null
})

function reset() {
  controller?.abort()
  started.value = false
  interviewId.value = null
  turns.value = []
  answer.value = ''
  streamText.value = ''
  errorMsg.value = ''
}

async function loadHistory() {
  if (!loggedIn.value) {
    history.value = []
    return
  }
  try {
    history.value = await $fetch<InterviewSummary[]>('/api/interviews', { query: { questionId: props.question.id } })
  } catch {
    history.value = []
  }
}

onMounted(loadHistory)
watch(
  () => props.question.id,
  () => {
    reset()
    expanded.value = null
    loadHistory()
  },
)
watch(loggedIn, () => {
  loadHistory()
  refreshAi()
})
onBeforeUnmount(() => controller?.abort())

function start() {
  reset()
  started.value = true
  nextTick(() => textarea.value?.focus())
}

/** 题目信息栏的"AI 模拟面试"按钮调用：滚动到面板，条件满足时直接开始 */
function open() {
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  if (!started.value && loggedIn.value && canUse.value && !outOfQuota.value) start()
}
defineExpose({ open })

function syncStatus(status: StudyStatus) {
  const current = records.value[props.question.id]
  records.value = {
    ...records.value,
    [props.question.id]: {
      status,
      starred: current?.starred ?? false,
      note: current?.note ?? null,
      updatedAt: new Date().toISOString(),
    },
  }
}

async function submit() {
  const text = answer.value.trim()
  if (text.length < 2 || streaming.value) return
  errorMsg.value = ''
  pendingAnswer.value = text
  streamText.value = ''
  streaming.value = true
  controller = new AbortController()

  try {
    const res = await fetch('/api/interviews/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headersFor() },
      body: JSON.stringify({ questionId: props.question.id, interviewId: interviewId.value ?? undefined, answer: text }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.message || `请求失败（${res.status}）`)
    }
    for await (const ev of readSSE(res.body)) {
      const data = JSON.parse(ev.data)
      if (ev.event === 'delta') {
        streamText.value += data.text
      } else if (ev.event === 'error') {
        throw new Error(data.message)
      } else if (ev.event === 'done') {
        interviewId.value = data.interviewId
        turns.value = [
          ...turns.value,
          { answer: text, feedback: streamText.value, score: data.score, followUp: data.followUp, at: new Date().toISOString() },
        ]
        answer.value = ''
        if (ai.value && data.remaining !== null) ai.value = { ...ai.value, remaining: data.remaining }
        if (data.studyStatus) syncStatus(data.studyStatus)
      }
    }
  } catch (error) {
    errorMsg.value = controller?.signal.aborted
      ? '已停止生成，这一轮没有记录'
      : error instanceof Error
        ? error.message
        : '出错了，请重试'
    // 中途停止也会计入次数，以服务端为准刷新剩余次数
    refreshAi()
  } finally {
    streaming.value = false
    streamText.value = ''
    controller = null
    if (finished.value) loadHistory()
    else nextTick(() => textarea.value?.focus())
  }
}

const stop = () => controller?.abort()

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <section id="interview" ref="root" class="interview ai-border">
    <header class="head">
      <div class="title">
        <span class="badge" aria-hidden="true">✦</span>
        <div>
          <h2 class="serif">AI 模拟面试官</h2>
          <p>用自己的话回答，AI 对照参考答案打分、指出遗漏，再追问，最多 {{ MAX_ROUNDS }} 轮</p>
        </div>
      </div>
      <div class="head-side">
        <ol v-if="started" class="rounds" :aria-label="`第 ${Math.min(turns.length + 1, MAX_ROUNDS)} 轮，共 ${MAX_ROUNDS} 轮`">
          <li v-for="n in MAX_ROUNDS" :key="n" :class="{ done: n <= turns.length, current: n === turns.length + 1 && !finished }" />
        </ol>
        <span v-if="loggedIn && hasKey" class="quota own" :title="`使用你自己的 API Key，模型：${aiKey?.model}`">自己的 Key · {{ aiKey?.model }}</span>
        <span v-else-if="ai?.enabled && loggedIn" class="quota" :title="`模型：${ai.model}`">今日剩余 {{ ai.remaining }} 次</span>
        <button
          v-if="loggedIn"
          type="button"
          class="settings-btn"
          :aria-expanded="showSettings"
          title="AI 设置：使用自己的 API Key"
          @click="showSettings = !showSettings"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4" /><path d="m10.85 12.15 8.65-8.65M18 5l2 2M15 8l2 2" /></svg>
          <span>{{ hasKey ? 'AI 设置' : '用自己的 Key' }}</span>
        </button>
      </div>
    </header>

    <div v-if="!loggedIn" class="notice">
      <span class="notice-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      </span>
      <span class="notice-text">登录后就可以和 AI 面试官对练，面试记录也会保存下来。</span>
      <NuxtLink :to="`/login?redirect=${encodeURIComponent(route.fullPath)}`" class="btn btn-sm btn-primary">登录</NuxtLink>
    </div>

    <InterviewAiSettings
      v-if="loggedIn && showSettings"
      :extra-hosts="ai?.extraHosts ?? []"
      @close="showSettings = false"
      @saved="showSettings = false"
    />

    <div v-if="loggedIn && ai && !canUse && !showSettings" class="notice">
      <span class="notice-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
      </span>
      <span class="notice-text">
        站点还没有配置 AI 服务，填写你自己的 API Key 就可以使用。<template v-if="user?.role === 'admin'">也可以在 <code>.env</code> 里填写 <code>NUXT_AI_API_KEY</code> 给所有用户开启。</template>
      </span>
      <button type="button" class="btn btn-sm btn-primary" @click="showSettings = true">填写 API Key</button>
    </div>

    <template v-else-if="loggedIn && canUse">
      <div v-if="!started" class="intro">
        <ol class="intro-steps">
          <li><b>01</b>用自己的话作答</li>
          <li><b>02</b>AI 打分并指出遗漏</li>
          <li><b>03</b>接住追问</li>
        </ol>
        <div class="intro-actions">
          <button type="button" class="btn btn-ai" :disabled="outOfQuota" @click="start">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>
            开始面试
          </button>
          <span v-if="outOfQuota" class="intro-tip">
            今天的次数用完了，可以<button type="button" class="link-btn" @click="showSettings = true">填写自己的 API Key</button>继续
          </span>
          <span v-else class="intro-tip">建议先打开"自测模式"，不看答案直接作答</span>
        </div>
      </div>

      <div v-else class="chat">
        <template v-for="(turn, i) in turns" :key="turn.at">
          <div class="msg ai">
            <span class="avatar" aria-hidden="true">✦</span>
            <div class="bubble"><span class="round">第 {{ i + 1 }} 轮</span>{{ askedAt(i) }}</div>
          </div>
          <div class="msg me"><div class="bubble">{{ turn.answer }}</div></div>
          <InterviewFeedback :text="turn.feedback" :score="turn.score" />
        </template>

        <template v-if="!finished">
          <div class="msg ai">
            <span class="avatar" aria-hidden="true">✦</span>
            <div class="bubble">
              <span class="round">第 {{ turns.length + 1 }} 轮{{ turns.length ? ' · 追问' : '' }}</span>
              {{ currentQuestion }}
            </div>
          </div>

          <template v-if="streaming">
            <div class="msg me"><div class="bubble">{{ pendingAnswer }}</div></div>
            <InterviewFeedback :text="streamText" streaming />
            <div class="actions">
              <button type="button" class="btn btn-sm" @click="stop">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                停止生成
              </button>
            </div>
          </template>

          <div v-else class="answer">
            <textarea
              ref="textarea"
              v-model="answer"
              rows="5"
              maxlength="3000"
              placeholder="像面试时一样，用自己的话回答……"
              @keydown.ctrl.enter.prevent="submit"
              @keydown.meta.enter.prevent="submit"
            />
            <div class="actions">
              <InterviewVoiceInput v-model="answer" :maxlength="3000" />
              <span class="count"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 提交 · {{ answer.length }}/3000</span>
              <button type="button" class="btn btn-sm btn-ghost" @click="reset">结束面试</button>
              <button type="button" class="btn btn-sm btn-primary" :disabled="answer.trim().length < 2" @click="submit">
                提交回答
              </button>
            </div>
          </div>
        </template>

        <div v-else class="summary">
          <InterviewScore :score="average" size="ring" />
          <div class="summary-text">
            <p class="summary-title serif">本次面试结束，共 {{ turns.length }} 轮</p>
            <p>平均得分 {{ average ?? '—' }}。低于 8 分的题已自动标记为"不会"或"模糊"，方便之后复习。</p>
          </div>
          <div class="summary-actions">
            <button
              v-if="average !== null && average >= 8 && records[question.id]?.status !== 'mastered'"
              type="button"
              class="btn btn-sm"
              @click="setStatus(question.id, 'mastered')"
            >
              标记为掌握
            </button>
            <button type="button" class="btn btn-sm btn-primary" @click="start">再来一次</button>
          </div>
        </div>
      </div>

      <p v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</p>
    </template>

    <div v-if="history.length" class="history">
      <p class="history-title">历史面试</p>
      <ul>
        <li v-for="item in history" :key="item.id">
          <button type="button" class="history-row" :aria-expanded="expanded === item.id" @click="expanded = expanded === item.id ? null : item.id">
            <span class="history-time">{{ formatTime(item.updatedAt) }}</span>
            <span class="history-rounds">{{ item.rounds }} 轮</span>
            <InterviewScore :score="item.score" />
            <svg :class="{ open: expanded === item.id }" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <div v-if="expanded === item.id" class="history-detail">
            <template v-for="(turn, i) in item.turns" :key="turn.at">
              <p class="q">问：{{ i === 0 ? plainTitle(question.title) : item.turns[i - 1]?.followUp }}</p>
              <p class="a">答：{{ turn.answer }}</p>
              <InterviewFeedback :text="turn.feedback" :score="turn.score" />
            </template>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.interview {
  position: relative;
  margin-top: 56px;
  padding: 24px;
  border-radius: var(--r-xl);
  scroll-margin-top: calc(var(--header-h) + 20px);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

/* 顶部一抹渐变光 */
.interview::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 160px;
  background: var(--ai-soft);
  mask-image: linear-gradient(to bottom, #000, transparent);
  pointer-events: none;
}

.interview > * {
  position: relative;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

.title {
  display: flex;
  gap: 14px;
}

.badge,
.avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--ai-grad);
  color: #fff;
}

.badge {
  width: 44px;
  height: 44px;
  font-size: 18px;
  box-shadow: 0 8px 20px -8px rgba(110, 80, 240, 0.6);
}

h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}

.title p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--c-text-2);
}

.head-side {
  display: flex;
  align-items: center;
  gap: 12px;
}

.quota.own {
  border-color: color-mix(in srgb, var(--ai-via) 35%, var(--c-divider));
  color: var(--ai-text);
}

.settings-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-full);
  background: var(--c-bg-elv);
  font-size: 12px;
  color: var(--c-text-2);
  cursor: pointer;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}

.settings-btn:hover,
.settings-btn[aria-expanded='true'] {
  border-color: var(--c-brand);
  color: var(--c-brand);
}

.link-btn {
  padding: 0 2px;
  border: 0;
  background: none;
  font: inherit;
  color: var(--c-brand);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.rounds {
  display: flex;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rounds li {
  width: 18px;
  height: 4px;
  border-radius: 2px;
  background: var(--c-bg-mute);
}

.rounds li.done {
  background: var(--ai-via);
}

.rounds li.current {
  background: color-mix(in srgb, var(--ai-via) 45%, var(--c-bg-mute));
}

.quota {
  padding: 3px 10px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-full);
  background: var(--c-bg-elv);
  font-size: 12px;
  color: var(--c-text-2);
}

.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg-elv);
  font-size: 14px;
  color: var(--c-text-2);
}

.notice-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--c-bg-soft);
  color: var(--c-text-2);
}

.notice-text {
  flex: 1;
  min-width: 200px;
}

.notice code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--code-inline-bg);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.intro-steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.intro-steps li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg-elv);
  font-size: 13px;
  font-weight: 500;
}

.intro-steps b {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ai-text);
}

.intro-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}

.intro-tip {
  font-size: 13px;
  color: var(--c-text-3);
}

.chat {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.msg {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.msg.me {
  justify-content: flex-end;
}

.avatar {
  width: 32px;
  height: 32px;
  font-size: 13px;
}

.bubble {
  max-width: 85%;
  padding: 11px 15px;
  border-radius: 16px;
  font-size: 14.5px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai .bubble {
  border: 1px solid var(--c-divider);
  border-top-left-radius: 4px;
  background: var(--c-bg-elv);
  font-weight: 500;
  /* 只有用户的回答需要保留换行；这里保留会把模板里的缩进也显示出来 */
  white-space: normal;
}

.me .bubble {
  border-top-right-radius: 4px;
  background: var(--c-ink);
  color: var(--c-on-ink);
}

.round {
  display: block;
  margin-bottom: 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ai-text);
}

.answer textarea {
  display: block;
  width: 100%;
  min-height: 132px;
  padding: 14px 16px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  font: inherit;
  font-size: 14.5px;
  line-height: 1.75;
  resize: vertical;
  transition:
    border-color var(--dur),
    box-shadow var(--dur);
}

.answer textarea:focus {
  border-color: var(--ai-via);
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ai-via) 18%, transparent);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.count {
  margin-right: auto;
  font-size: 12px;
  color: var(--c-text-3);
}

.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 20px;
  padding: 18px 20px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
}

.summary-text {
  flex: 1;
  min-width: 220px;
}

.summary-text p {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-2);
}

.summary-text .summary-title {
  margin-bottom: 4px;
  font-size: 17px;
  font-weight: 700;
  color: var(--c-text-1);
}

.summary-actions {
  display: flex;
  gap: 8px;
}

.error {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--c-danger);
}

.history {
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid var(--c-divider);
}

.history-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--c-text-3);
}

.history ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 8px;
  border: none;
  border-radius: var(--r-sm);
  background: none;
  font-size: 13px;
  cursor: pointer;
}

.history-row:hover {
  background: var(--c-default-soft);
}

.history-rounds {
  color: var(--c-text-3);
}

.history-row :deep(.score) {
  margin-left: auto;
}

.history-row svg {
  color: var(--c-text-3);
  transition: transform var(--dur);
}

.history-row svg.open {
  transform: rotate(180deg);
}

.history-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 8px 16px;
  font-size: 13px;
}

.history-detail p {
  margin: 0;
  white-space: pre-wrap;
}

.history-detail .q {
  font-weight: 600;
}

.history-detail .a {
  color: var(--c-text-2);
}

.history-detail :deep(.feedback) {
  margin-left: 0;
}

@media (max-width: 640px) {
  .interview {
    padding: 18px 16px;
  }

  .intro-steps {
    grid-template-columns: minmax(0, 1fr);
  }

  .bubble {
    max-width: 92%;
  }
}
</style>

