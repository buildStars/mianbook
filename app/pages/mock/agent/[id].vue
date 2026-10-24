<script setup lang="ts">
import type { AgentSessionDetail, AgentTimelineItem } from '#shared/types/agent'

interface AiStatus {
  enabled: boolean
  remaining: number
  extraHosts: string[]
  allowUserKey: boolean
}

const route = useRoute()
const id = Number(route.params.id)
const { loggedIn } = useUserSession()
const { hasKey: hasStoredKey, headersFor } = useAiKey()
const { refresh: refreshReview } = useReview()
const { load: reloadStudy } = useStudy()
const { data: ai } = useFetch<AiStatus>('/api/ai/status', { key: 'ai-status' })
const hasKey = computed(() => hasStoredKey.value && ai.value?.allowUserKey !== false)
const allowOwnKey = computed(() => ai.value?.allowUserKey !== false)
const showSettings = ref(false)

const detail = ref<AgentSessionDetail | null>(null)
const loadError = ref('')
/** 正在进行的这一轮推过来的条目，结束后重新加载完整记录 */
const live = ref<AgentTimelineItem[]>([])
const streaming = ref(false)
const errorMsg = ref('')
const remaining = ref<number | null>(null)
const answer = ref('')
const voice = ref<{ stop: () => void }>()
const end = ref<HTMLElement>()
let controller: AbortController | null = null
let lastRequest: { action: 'start' | 'answer' | 'skip' | 'finish'; answer?: string } | null = null

useHead({ title: '面试 | Agent 面试官' })

const finished = computed(() => detail.value?.status === 'finished')
const timeline = computed(() => [...(detail.value?.timeline ?? []), ...live.value])
/** 打分卡片上"看原题"的链接：从出题条目里找 */
const pathOf = computed(() => {
  const map = new Map<number, string>()
  for (const item of timeline.value) if (item.type === 'question') map.set(item.questionId, item.path)
  return map
})

async function load() {
  try {
    detail.value = await $fetch<AgentSessionDetail>(`/api/agent/${id}`)
  } catch (error: any) {
    loadError.value = error?.data?.message ?? '加载失败，请刷新重试'
  }
}

onMounted(async () => {
  await load()
  // 刚创建的面试：自动开始第一轮（面试官看记录、找题、出第一题）
  if (detail.value && !detail.value.timeline.length && detail.value.status === 'active') send({ action: 'start' })
})
onBeforeUnmount(() => controller?.abort())

const scrollToEnd = () => nextTick(() => end.value?.scrollIntoView({ behavior: 'smooth', block: 'end' }))

async function send(body: { action: 'start' | 'answer' | 'skip' | 'finish'; answer?: string }) {
  if (streaming.value) return
  voice.value?.stop()
  lastRequest = body
  errorMsg.value = ''
  streaming.value = true
  live.value = []
  if (body.action === 'answer') live.value.push({ type: 'answer', text: body.answer! })
  if (body.action === 'skip') live.value.push({ type: 'action', text: '你跳过了这道题' })
  if (body.action === 'finish') live.value.push({ type: 'action', text: '你提前结束了面试' })
  scrollToEnd()
  controller = new AbortController()
  try {
    await postSSE(`/api/agent/${id}/turn`, body, { headers: headersFor(), signal: controller.signal }, (event, data) => {
      if (event === 'delta') {
        const last = live.value.at(-1)
        if (last?.type === 'agent') last.text += data.text
        else {
          live.value.push({ type: 'agent', text: data.text })
          scrollToEnd()
        }
      } else if (event === 'tool_start') {
        live.value.push({ type: 'step', id: data.id, tool: data.tool, label: data.label, error: null, running: true })
        scrollToEnd()
      } else if (event === 'tool_end') {
        const i = live.value.findIndex((it) => 'id' in it && it.id === data.item.id)
        if (i >= 0) live.value.splice(i, 1, data.item)
        else live.value.push(data.item)
      } else if (event === 'done') {
        remaining.value = data.remaining
      }
    })
    if (body.action === 'answer') answer.value = ''
  } catch (error) {
    if (!controller.signal.aborted) errorMsg.value = error instanceof Error ? error.message : '出错了，请稍后再试'
  } finally {
    controller = null
    streaming.value = false
    // 以服务端保存的记录为准；打分会改复习计划和学习记录，顺手刷新
    await load()
    live.value = []
    refreshReview()
    reloadStudy()
    scrollToEnd()
  }
}

function submit() {
  const text = answer.value.trim()
  if (text.length < 2) return
  send({ action: 'answer', answer: text })
}

function stop() {
  controller?.abort()
}

function retry() {
  if (lastRequest) send(lastRequest)
}

function finishNow() {
  if (confirm('现在结束面试吗？面试官会根据已经答过的题写总结。')) send({ action: 'finish' })
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n))
const STEP_ICONS: Record<string, string> = {
  get_learning_profile: 'M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6',
  search_questions: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  get_question_reference: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM8 7h7M8 11h5',
}
</script>

<template>
  <div class="page container">
    <NuxtLink to="/mock?mode=agent" class="back">← Agent 面试官</NuxtLink>

    <div v-if="!loggedIn" class="notice card">
      <p>请先登录。</p>
      <NuxtLink :to="`/login?redirect=/mock/agent/${id}`" class="btn btn-primary">登录</NuxtLink>
    </div>
    <p v-else-if="loadError" class="error" role="alert">{{ loadError }}</p>

    <template v-else-if="detail">
      <header class="head">
        <div>
          <p class="eyebrow">AGENT INTERVIEW · 自适应面试</p>
          <h1 class="serif">{{ detail.goal }}</h1>
        </div>
        <div class="head-side">
          <span class="progress-text num">第 {{ detail.asked }} / {{ detail.maxQuestions }} 题</span>
          <InterviewScore v-if="detail.score !== null" :score="detail.score" />
          <span v-if="hasKey" class="quota own">使用你自己的 Key</span>
          <span v-else-if="remaining !== null" class="quota">还剩 {{ remaining }} 次</span>
        </div>
      </header>
      <div class="bar" aria-hidden="true"><i :style="{ width: `${(detail.asked / detail.maxQuestions) * 100}%` }" /></div>

      <ol class="timeline">
        <li v-for="(item, i) in timeline" :key="i" :class="`t-${item.type}`">
          <!-- 面试官的话：已转义原始 HTML 并禁用图片，见 renderAiMarkdown -->
          <div v-if="item.type === 'agent'" class="agent-msg">
            <span class="who ai-text">面试官</span>
            <div class="md" v-html="renderAiMarkdown(item.text)" />
          </div>

          <div v-else-if="item.type === 'answer'" class="answer">
            <span class="who">你的回答</span>
            <p>{{ item.text }}</p>
          </div>

          <p v-else-if="item.type === 'action'" class="action">{{ item.text }}</p>

          <div v-else-if="item.type === 'step'" class="step" :class="{ bad: item.error, running: item.running }">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path :d="STEP_ICONS[item.tool] ?? 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z'" />
            </svg>
            <span>{{ item.running ? `${item.label}…` : item.label }}</span>
            <span v-if="item.error" class="step-error">：{{ item.error }}</span>
          </div>

          <div v-else-if="item.type === 'question'" class="question card ai-border">
            <span class="q-badge">{{ item.followUp ? '追问' : `第 ${item.index} 题` }}</span>
            <p class="q-title"><RichTitle :title="item.title" /></p>
            <p v-if="item.followUp" class="q-follow">{{ item.followUp }}</p>
            <p class="q-meta">{{ item.category }} · <span :title="`难度 ${item.difficulty}`">{{ stars(item.difficulty) }}</span></p>
          </div>

          <div v-else-if="item.type === 'assessment'" class="assessment card">
            <div class="as-head">
              <InterviewScore :score="item.score" />
              <span class="as-title"><RichTitle :title="item.title" /></span>
              <NuxtLink v-if="pathOf.get(item.questionId)" :to="pathOf.get(item.questionId)!" target="_blank" class="as-link">看原题 ↗</NuxtLink>
            </div>
            <ul class="as-list">
              <li v-for="s in item.strengths" :key="`s${s}`" class="ok">{{ s }}</li>
              <li v-for="g in item.gaps" :key="`g${g}`" class="gap">{{ g }}</li>
            </ul>
            <p v-if="item.nextReview" class="as-review">已写进复习计划，下次复习 {{ item.nextReview }}</p>
          </div>

          <div v-else-if="item.type === 'finish'" class="finish card ai-border">
            <p class="eyebrow">面试总结</p>
            <p class="finish-text">{{ item.summary }}</p>
            <ol v-if="item.nextSteps.length" class="finish-steps">
              <li v-for="s in item.nextSteps" :key="s">{{ s }}</li>
            </ol>
            <div class="finish-actions">
              <NuxtLink to="/review" class="btn btn-sm btn-primary">去复习</NuxtLink>
              <NuxtLink to="/mock?mode=agent" class="btn btn-sm">再来一场</NuxtLink>
            </div>
          </div>
        </li>
        <li v-if="streaming && !live.some((l) => l.type === 'agent' || l.type === 'step')" class="t-step">
          <div class="step running"><span>面试官在思考…</span></div>
        </li>
      </ol>

      <div v-if="errorMsg" class="error-box" role="alert">
        <span>{{ errorMsg }}</span>
        <button type="button" class="btn btn-sm" @click="retry">重试</button>
      </div>

      <InterviewAiSettings v-if="showSettings" class="settings" :extra-hosts="ai?.extraHosts ?? []" @close="showSettings = false" @saved="showSettings = false" />

      <form v-if="!finished" class="composer card" @submit.prevent="submit">
        <p class="composer-label">
          <template v-if="detail.awaiting">回答：<b>{{ detail.awaiting.followUp ?? plainTitle(detail.awaiting.title) }}</b></template>
          <template v-else>回复面试官</template>
        </p>
        <textarea
          v-model="answer"
          rows="4"
          maxlength="3000"
          :disabled="streaming"
          :placeholder="detail.awaiting ? '用自己的话回答，像真实面试一样讲清楚原理和取舍' : '比如：我想多练练 React'"
          aria-label="回答"
          @keydown.ctrl.enter="submit"
          @keydown.meta.enter="submit"
        />
        <div class="composer-bar">
          <InterviewVoiceInput ref="voice" v-model="answer" :maxlength="3000" :disabled="streaming" />
          <span class="hint">Ctrl + Enter 提交</span>
          <div class="actions">
            <button v-if="allowOwnKey" type="button" class="btn btn-sm btn-ghost" @click="showSettings = !showSettings">AI 设置</button>
            <button type="button" class="btn btn-sm btn-ghost" :disabled="streaming" @click="finishNow">结束面试</button>
            <button v-if="detail.awaiting" type="button" class="btn btn-sm" :disabled="streaming" @click="send({ action: 'skip' })">跳过</button>
            <button v-if="streaming" type="button" class="btn btn-sm" @click="stop">停止</button>
            <button v-else type="submit" class="btn btn-sm btn-ai" :disabled="answer.trim().length < 2">提交</button>
          </div>
        </div>
      </form>
      <div ref="end" class="end" />
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 820px;
  padding-top: 32px;
  padding-bottom: 80px;
}

.back {
  font-size: 13px;
  color: var(--c-text-2);
}

.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 24px;
  padding: 20px 24px;
}

.notice p {
  margin: 0;
  color: var(--c-text-2);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
}

.head h1 {
  margin: 8px 0 0;
  font-size: clamp(22px, 3vw, 30px);
  font-weight: 800;
  line-height: 1.4;
}

.head-side {
  display: flex;
  align-items: center;
  gap: 10px;
}

.progress-text {
  font-size: 13px;
  color: var(--c-text-2);
}

.quota {
  padding: 3px 10px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-full);
  background: var(--c-bg-elv);
  font-size: 12px;
  color: var(--c-text-2);
}

.quota.own {
  color: var(--ai-text);
}

.bar {
  height: 4px;
  margin: 16px 0 8px;
  border-radius: var(--r-full);
  background: var(--c-bg-mute);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  background: var(--ai-grad);
  transition: width 0.4s;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
}

.who {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--c-text-3);
}

.agent-msg .md {
  font-size: 15px;
  line-height: 1.85;
  overflow-wrap: anywhere;
}

.md :deep(p),
.md :deep(ul),
.md :deep(ol) {
  margin: 4px 0;
}

.md :deep(ul),
.md :deep(ol) {
  padding-left: 1.3em;
}

.md :deep(ul) {
  list-style: disc;
}

.md :deep(ol) {
  list-style: decimal;
}

.md :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.md :deep(pre) {
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
  font-size: 13px;
  overflow-x: auto;
}

.answer {
  align-self: flex-end;
  max-width: 88%;
  padding: 12px 16px;
  border-radius: var(--r-lg) var(--r-lg) 4px var(--r-lg);
  background: var(--c-brand-soft);
}

.t-answer {
  display: flex;
  justify-content: flex-end;
}

.answer p {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.action {
  margin: 0;
  font-size: 13px;
  text-align: center;
  color: var(--c-text-3);
}

.step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 10px;
  border-radius: var(--r-full);
  background: var(--c-default-soft);
  color: var(--c-text-2);
  font-size: 12.5px;
}

.step svg {
  flex: none;
  color: var(--ai-text);
}

.step.running {
  background: var(--ai-soft);
}

.step.running span {
  animation: pulse 1.4s infinite ease-in-out;
}

@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .step.running span {
    animation: none;
  }
}

.step.bad {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.step-error {
  overflow-wrap: anywhere;
}

.question {
  padding: 16px 20px;
}

.q-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--r-sm);
  background: var(--ai-soft);
  color: var(--ai-text);
  font-size: 12px;
  font-weight: 700;
}

.q-title {
  margin: 8px 0 0;
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
}

.q-follow {
  margin: 6px 0 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.6;
}

.q-meta {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--c-text-3);
}

.assessment {
  padding: 14px 18px;
}

.as-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.as-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
}

.as-link {
  flex: none;
  font-size: 12.5px;
}

.as-list {
  display: grid;
  gap: 4px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  font-size: 13.5px;
  line-height: 1.6;
}

.as-list li {
  display: flex;
  gap: 8px;
}

.as-list li::before {
  flex: none;
  width: 16px;
  font-weight: 700;
  text-align: center;
}

.as-list .ok::before {
  content: '✓';
  color: var(--c-success);
}

.as-list .gap::before {
  content: '✗';
  color: var(--c-danger);
}

.as-review {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--c-text-3);
}

.finish {
  padding: 18px 22px;
}

.finish-text {
  margin: 8px 0 0;
  font-size: 15px;
  line-height: 1.8;
}

.finish-steps {
  margin: 10px 0 0;
  padding-left: 1.3em;
  list-style: decimal;
  font-size: 14px;
  line-height: 1.8;
}

.finish-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.error,
.error-box {
  color: var(--c-danger);
}

.error-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  font-size: 14px;
}

.settings {
  margin-top: 16px;
}

.composer {
  margin-top: 24px;
  padding: 14px 16px 12px;
}

.composer-label {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--c-text-2);
}

.composer-label b {
  color: var(--c-text-1);
}

.composer textarea {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg);
  color: var(--c-text-1);
  font: inherit;
  font-size: 15px;
  line-height: 1.7;
  resize: vertical;
}

.composer textarea:focus {
  border-color: var(--ai-via);
  outline: none;
}

.composer-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.hint {
  font-size: 12px;
  color: var(--c-text-3);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

.end {
  height: 1px;
}

@media (max-width: 640px) {
  .hint {
    display: none;
  }

  .answer {
    max-width: 100%;
  }
}
</style>
