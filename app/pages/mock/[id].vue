<script setup lang="ts">
import type { MockSessionDetail } from '#shared/types/handbook'

interface AiStatus {
  enabled: boolean
  model: string
  remaining: number
  /** 管理员关闭了这个用户使用站点 AI 的权限 */
  blocked?: boolean
  extraHosts: string[]
  allowUserKey: boolean
}

const route = useRoute()
const id = Number(route.params.id)
const { loggedIn } = useUserSession()
const { hasKey: hasStoredKey, config: aiKey, headersFor } = useAiKey()
const { refresh: refreshReview } = useReview()
const { load: reloadStudy } = useStudy()
const { data: ai, refresh: refreshAi } = useFetch<AiStatus>('/api/ai/status', { key: 'ai-status' })
/** 后台可能关闭了"用户自带 Key"，这时即使浏览器里存着 Key 也不用 */
const hasKey = computed(() => hasStoredKey.value && ai.value?.allowUserKey !== false)
const allowOwnKey = computed(() => ai.value?.allowUserKey !== false)

const detail = ref<MockSessionDetail | null>(null)
const loadError = ref('')
const answer = ref('')
const pendingAnswer = ref('')
const streaming = ref(false)
const streamText = ref('')
const errorMsg = ref('')
const busy = ref(false)
const showSettings = ref(false)
const showDetails = ref<number | null>(null)
const textarea = ref<HTMLTextAreaElement>()
let controller: AbortController | null = null

useHead({ title: computed(() => detail.value?.title ?? '模拟面试') })

async function load() {
  try {
    detail.value = await $fetch<MockSessionDetail>(`/api/mock/${id}`)
  } catch (error: any) {
    loadError.value = error?.data?.message ?? '加载失败，请刷新重试'
  }
}
onMounted(load)
onBeforeUnmount(() => controller?.abort())

const finished = computed(() => detail.value?.status === 'finished')
const item = computed(() => (detail.value ? detail.value.items[detail.value.currentIndex] : undefined))
const isLast = computed(() => !!detail.value && detail.value.currentIndex >= detail.value.items.length - 1)
const maxRounds = computed(() => 1 + (detail.value?.config.followUps ?? 0))
const askedAt = (i: number) => {
  const it = item.value!
  return i === 0 ? plainTitle(it.question.title) : (it.turns[i - 1]?.followUp ?? '')
}
const remainingCount = computed(() => detail.value?.items.filter((i) => !i.done).length ?? 0)

const scoreOf = (it: { skipped: boolean; scores: (number | null)[] }) => {
  if (it.skipped) return 0
  const s = it.scores.filter((x): x is number => x !== null)
  return s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : null
}
const level = (s: number | null) => (s === null ? 'none' : s >= 8 ? 'good' : s >= 5 ? 'ok' : 'bad')

async function submit() {
  const it = item.value
  const text = answer.value.trim()
  if (!it || text.length < 2 || streaming.value) return
  errorMsg.value = ''
  pendingAnswer.value = text
  streamText.value = ''
  streaming.value = true
  controller = new AbortController()
  try {
    await postSSE(
      '/api/interviews/stream',
      { questionId: it.questionId ?? undefined, sessionId: id, interviewId: it.interviewId ?? undefined, answer: text },
      { headers: headersFor(), signal: controller.signal },
      (event, data) => {
        if (event === 'delta') streamText.value += data.text
        else if (event === 'done') {
          it.turns.push({ answer: text, feedback: streamText.value, score: data.score, followUp: data.followUp, at: new Date().toISOString() })
          it.scores.push(data.score)
          it.interviewId = data.interviewId
          it.done = data.finished
          answer.value = ''
          if (ai.value && data.remaining !== null) ai.value = { ...ai.value, remaining: data.remaining }
        }
      },
    )
  } catch (error) {
    errorMsg.value = controller?.signal.aborted ? '已停止生成，这一轮没有记录' : error instanceof Error ? error.message : '出错了，请重试'
    refreshAi()
  } finally {
    streaming.value = false
    streamText.value = ''
    controller = null
    if (!item.value?.done) nextTick(() => textarea.value?.focus())
  }
}

const stop = () => controller?.abort()

async function call(path: string) {
  if (busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    await $fetch(`/api/mock/${id}/${path}`, { method: 'POST' })
    await load()
    answer.value = ''
    nextTick(() => textarea.value?.focus())
  } catch (error: any) {
    errorMsg.value = error?.data?.message ?? '操作失败，请重试'
  } finally {
    busy.value = false
  }
}

function skip() {
  const answered = (item.value?.turns.length ?? 0) > 0
  if (!answered && !confirm('跳过这道题会按"不会"处理：记 0 分，并加入复习计划。确定跳过吗？')) return
  call('skip')
}

async function finish() {
  if (remainingCount.value && !confirm(`还有 ${remainingCount.value} 道题没答，结束后这些题不计分。确定结束吗？`)) return
  busy.value = true
  try {
    detail.value = await $fetch<MockSessionDetail>(`/api/mock/${id}/finish`, { method: 'POST' })
    refreshReview()
    reloadStudy()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (error: any) {
    errorMsg.value = error?.data?.message ?? '操作失败，请重试'
  } finally {
    busy.value = false
  }
}

// ---- 结果页 ----
const reportText = ref('')
const reportStreaming = ref(false)
const reportError = ref('')
const reportHtml = computed(() => renderAiMarkdown(reportStreaming.value ? reportText.value : (detail.value?.report ?? '')))

async function generateReport() {
  if (reportStreaming.value) return
  reportStreaming.value = true
  reportError.value = ''
  reportText.value = ''
  controller = new AbortController()
  try {
    await postSSE(`/api/mock/${id}/report`, {}, { headers: headersFor(), signal: controller.signal }, (event, data) => {
      if (event === 'delta') reportText.value += data.text
      else if (event === 'done') {
        if (detail.value) detail.value.report = reportText.value
        if (ai.value && data.remaining !== null) ai.value = { ...ai.value, remaining: data.remaining }
      }
    })
  } catch (error) {
    reportError.value = controller?.signal.aborted ? '已停止生成' : error instanceof Error ? error.message : '生成失败，请重试'
  } finally {
    reportStreaming.value = false
    controller = null
  }
}

const answeredItems = computed(() => detail.value?.items.filter((i) => i.done) ?? [])
const skippedCount = computed(() => detail.value?.items.filter((i) => i.skipped).length ?? 0)
const byCategory = computed(() => {
  const map = new Map<string, number[]>()
  for (const it of answeredItems.value) {
    const s = scoreOf(it)
    if (s === null) continue
    map.set(it.question.category, [...(map.get(it.question.category) ?? []), s])
  }
  return [...map.entries()]
    .map(([name, scores]) => ({ name, avg: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10, n: scores.length }))
    .sort((a, b) => a.avg - b.avg)
})
const toReview = computed(() => answeredItems.value.filter((it) => (scoreOf(it) ?? 10) < 8))
</script>

<template>
  <div class="page container">
    <NuxtLink to="/mock" class="back tap">← 模拟面试</NuxtLink>

    <div v-if="!loggedIn" class="notice card">
      <p>请先登录。</p>
      <NuxtLink :to="`/login?redirect=${encodeURIComponent(route.fullPath)}`" class="btn btn-primary">登录</NuxtLink>
    </div>
    <div v-else-if="loadError" class="notice card"><p>{{ loadError }}</p></div>
    <div v-else-if="!detail" class="notice card"><p>正在加载…</p></div>

    <template v-else>
      <header class="head">
        <div>
          <p class="eyebrow">{{ finished ? 'RESULT · 面试结果' : 'IN PROGRESS · 面试中' }}</p>
          <h1 class="serif">{{ detail.title }}</h1>
        </div>
        <div class="head-side">
          <span v-if="hasKey" class="quota own">自己的 Key · {{ aiKey?.model }}</span>
          <span v-else-if="ai?.enabled" class="quota">{{ ai.blocked ? '站点 AI 已关闭' : `AI 今日剩余 ${ai.remaining} 次` }}</span>
          <button v-if="!finished" type="button" class="btn btn-sm btn-ghost" :disabled="busy || streaming" @click="finish">结束面试</button>
        </div>
      </header>

      <!-- 题目进度 -->
      <ol class="steps" aria-label="题目进度">
        <li
          v-for="(it, i) in detail.items"
          :key="i"
          :class="[level(it.done ? scoreOf(it) : null), { current: !finished && i === detail.currentIndex, done: it.done }]"
          :title="`第 ${i + 1} 题：${plainTitle(it.question.title)}${it.done ? ` · ${it.skipped ? '跳过' : `${scoreOf(it) ?? '—'} 分`}` : ''}`"
        >
          <span>{{ i + 1 }}</span>
        </li>
      </ol>

      <InterviewAiSettings v-if="showSettings" :extra-hosts="ai?.extraHosts ?? []" @close="showSettings = false" @saved="showSettings = false" />

      <!-- 答题 -->
      <section v-if="!finished && item" class="stage card">
        <p class="q-meta">
          第 {{ detail.currentIndex + 1 }} / {{ detail.items.length }} 题 · {{ item.question.category
          }}<template v-if="item.question.difficulty"> · {{ DIFFICULTY_LABELS[item.question.difficulty] }}</template>
        </p>

        <div class="chat">
          <template v-for="(turn, i) in item.turns" :key="turn.at">
            <div class="msg ai">
              <span class="avatar" aria-hidden="true">✦</span>
              <div class="bubble"><span class="round">{{ i === 0 ? '面试官' : '追问' }}</span>{{ askedAt(i) }}</div>
            </div>
            <div class="msg me"><div class="bubble">{{ turn.answer }}</div></div>
            <!-- 追问会作为下一轮的问题出现时，卡片里不再重复 -->
            <InterviewFeedback :text="turn.feedback" :score="turn.score" :hide-follow-up="i < item.turns.length - 1 || !item.done" />
          </template>

          <template v-if="!item.done">
            <div class="msg ai">
              <span class="avatar" aria-hidden="true">✦</span>
              <div class="bubble">
                <span class="round">{{ item.turns.length ? `追问 · 第 ${item.turns.length + 1} / ${maxRounds} 轮` : '面试官' }}</span>
                <template v-if="item.turns.length">{{ askedAt(item.turns.length) }}</template>
                <RichTitle v-else :title="item.question.title" />
              </div>
            </div>

            <template v-if="streaming">
              <div class="msg me"><div class="bubble">{{ pendingAnswer }}</div></div>
              <InterviewFeedback :text="streamText" streaming />
              <div class="actions">
                <button type="button" class="btn btn-sm" @click="stop">停止生成</button>
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
                <span class="count"><span class="kbd-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 提交 · </span>{{ answer.length }}/3000</span>
                <button type="button" class="btn btn-sm btn-ghost" :disabled="busy" @click="skip">
                  {{ item.turns.length ? '跳过追问' : '不会，跳过' }}
                </button>
                <button type="button" class="btn btn-sm btn-primary" :disabled="answer.trim().length < 2" @click="submit">提交回答</button>
              </div>
            </div>
          </template>

          <div v-else class="item-done">
            <InterviewScore :score="scoreOf(item)" size="ring" />
            <p>
              这道题结束了{{ item.skipped ? '（跳过）' : '' }}。<template v-if="isLast">这是最后一道题。</template>
            </p>
            <button v-if="!isLast" type="button" class="btn btn-primary" :disabled="busy" @click="call('next')">下一题 →</button>
            <button v-else type="button" class="btn btn-ai" :disabled="busy" @click="finish">完成面试，查看结果</button>
          </div>
        </div>

        <p v-if="errorMsg" class="error" role="alert">
          {{ errorMsg }}
          <button v-if="!hasKey && allowOwnKey" type="button" class="link-btn" @click="showSettings = true">填写自己的 API Key</button>
        </p>
      </section>

      <!-- 结果 -->
      <template v-if="finished">
        <section class="result card">
          <InterviewScore :score="detail.score" size="ring" />
          <div class="result-text">
            <p class="result-title serif">平均 {{ detail.score ?? '—' }} 分</p>
            <p>
              共 {{ detail.items.length }} 题，答了 {{ answeredItems.length - skippedCount }} 题<template v-if="skippedCount">，跳过 {{ skippedCount }} 题</template
              ><template v-if="detail.items.length > answeredItems.length">，{{ detail.items.length - answeredItems.length }} 题没答（不计分）</template>。
              低于 8 分的题已标记为"不会"或"模糊"，并加入了复习计划。
            </p>
          </div>
          <NuxtLink to="/review" class="btn">去复习</NuxtLink>
        </section>

        <section class="report">
          <div class="section-head">
            <h2 class="serif">AI 总结</h2>
            <button v-if="detail.report && !reportStreaming" type="button" class="btn btn-sm btn-ghost" @click="generateReport">重新生成</button>
          </div>
          <div v-if="detail.report || reportStreaming" class="report-body" :class="{ streaming: reportStreaming }" v-html="reportHtml" />
          <div v-else class="report-empty">
            <p>根据每道题的得分和点评，生成一份总结：整体水平、主要问题和复习建议。</p>
            <button type="button" class="btn btn-ai" :disabled="!answeredItems.length || (!hasKey && !ai?.enabled)" @click="generateReport">生成 AI 总结</button>
          </div>
          <p v-if="reportError" class="error" role="alert">{{ reportError }}</p>
        </section>

        <section v-if="byCategory.length > 1" class="cats">
          <h2 class="serif">各分类得分</h2>
          <ul>
            <li v-for="c in byCategory" :key="c.name">
              <span class="cat-name">{{ c.name }}<small>{{ c.n }} 题</small></span>
              <span class="cat-bar"><i :class="level(c.avg)" :style="{ width: `${c.avg * 10}%` }" /></span>
              <b>{{ c.avg }}</b>
            </li>
          </ul>
        </section>

        <section class="items">
          <h2 class="serif">每道题</h2>
          <ol>
            <li v-for="(it, i) in detail.items" :key="i" class="item-row">
              <button type="button" class="item-head" :aria-expanded="showDetails === i" :disabled="!it.turns.length" @click="showDetails = showDetails === i ? null : i">
                <span class="item-no">{{ i + 1 }}</span>
                <span class="item-title"><RichTitle :title="it.question.title" /><small>{{ it.question.category }}</small></span>
                <span class="item-rounds">
                  <InterviewScore v-for="(s, k) in it.scores" :key="k" :score="s" />
                  <span v-if="it.skipped" class="tag-skip">跳过</span>
                  <span v-else-if="!it.done" class="tag-skip">未答</span>
                </span>
              </button>
              <div v-if="showDetails === i" class="item-detail">
                <template v-for="(turn, k) in it.turns" :key="turn.at">
                  <p class="q">问：{{ k === 0 ? plainTitle(it.question.title) : it.turns[k - 1]?.followUp }}</p>
                  <p class="a">答：{{ turn.answer }}</p>
                  <InterviewFeedback :text="turn.feedback" :score="turn.score" :hide-follow-up="k < it.turns.length - 1" />
                </template>
                <div v-if="it.points?.length" class="points">
                  <p>这道题想考察：</p>
                  <ul>
                    <li v-for="pt in it.points" :key="pt">{{ pt }}</li>
                  </ul>
                </div>
                <NuxtLink v-if="it.question.path" :to="it.question.path" class="item-link">看这道题的完整解析 →</NuxtLink>
              </div>
            </li>
          </ol>
        </section>

        <section v-if="toReview.length" class="to-review">
          <h2 class="serif">建议优先复习</h2>
          <ul>
            <li v-for="(it, i) in toReview" :key="i">
              <NuxtLink v-if="it.question.path" :to="it.question.path"><RichTitle :title="it.question.title" /></NuxtLink>
              <span v-else class="custom-title"><RichTitle :title="it.question.title" /></span>
              <span>{{ it.question.category }} · {{ it.skipped ? '跳过' : `${scoreOf(it)} 分` }}</span>
            </li>
          </ul>
        </section>

        <div class="again">
          <NuxtLink to="/mock" class="btn btn-ai btn-lg">再来一场</NuxtLink>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 880px;
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
  font-size: clamp(26px, 3.4vw, 36px);
  font-weight: 800;
}

.head-side {
  display: flex;
  align-items: center;
  gap: 10px;
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

/* 进度 */
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 22px 0 20px;
  padding: 0;
  list-style: none;
}

.steps li {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--c-divider);
  border-radius: 50%;
  background: var(--c-bg-elv);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--c-text-3);
}

.steps li.current {
  border-color: var(--c-brand);
  box-shadow: 0 0 0 3px var(--c-brand-soft);
  color: var(--c-brand);
  font-weight: 700;
}

.steps li.done {
  border-color: transparent;
  color: #fff;
  font-weight: 700;
}

.steps li.done.good {
  background: var(--st-mastered);
}

.steps li.done.ok {
  background: var(--st-fuzzy);
}

.steps li.done.bad {
  background: var(--st-weak);
}

.steps li.done.none {
  background: var(--c-text-3);
}

/* 答题 */
.stage {
  padding: 24px 26px 26px;
}

.q-meta {
  margin: 0 0 16px;
  font-size: 12.5px;
  color: var(--c-text-3);
}

.chat {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.msg {
  display: flex;
  gap: 10px;
}

.msg.me {
  justify-content: flex-end;
}

.avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--ai-grad);
  font-size: 13px;
  color: #fff;
}

.bubble {
  max-width: 82%;
  padding: 12px 16px;
  border-radius: var(--r-lg);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.msg.ai .bubble {
  border: 1px solid var(--c-divider);
  border-top-left-radius: 4px;
  background: var(--c-bg-soft);
  font-weight: 600;
}

.msg.me .bubble {
  border-top-right-radius: 4px;
  background: var(--c-ink);
  color: var(--c-on-ink);
}

.round {
  display: block;
  margin-bottom: 4px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ai-text);
}

.answer textarea {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg);
  color: var(--c-text-1);
  font: inherit;
  line-height: 1.7;
  resize: vertical;
}

.answer textarea:focus-visible {
  outline: 2px solid var(--c-brand);
  outline-offset: -1px;
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

.item-done {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-top: 6px;
  padding: 16px 18px;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
}

.item-done p {
  flex: 1;
  margin: 0;
  color: var(--c-text-2);
}

.error {
  margin: 14px 0 0;
  color: var(--st-weak-text);
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

/* 结果 */
.result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px;
  padding: 22px 26px;
}

.result-text {
  flex: 1 1 320px;
}

.result-title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
}

.result-text p:last-child {
  margin: 6px 0 0;
  font-size: 13.5px;
  color: var(--c-text-2);
}

section > h2,
.section-head h2 {
  margin: 0 0 14px;
  font-size: 20px;
  font-weight: 800;
}

.report,
.cats,
.items,
.to-review {
  margin-top: 40px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.report-body {
  padding: 18px 22px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  line-height: 1.8;
}

.report-body :deep(h3) {
  margin: 16px 0 6px;
  font-size: 14px;
  color: var(--ai-text);
}

.report-body :deep(h3:first-child) {
  margin-top: 0;
}

.report-body :deep(ul) {
  margin: 0;
  padding-left: 20px;
}

.report-body.streaming::after {
  content: '▍';
  color: var(--ai-text);
  animation: blink 1s steps(2) infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.report-empty {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  border: 1px dashed var(--c-border);
  border-radius: var(--r-lg);
}

.report-empty p {
  flex: 1 1 300px;
  margin: 0;
  color: var(--c-text-2);
}

.cats ul,
.to-review ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.cats li {
  display: grid;
  grid-template-columns: 170px 1fr 36px;
  align-items: center;
  gap: 14px;
  padding: 7px 0;
}

.cat-name small {
  margin-left: 6px;
  font-size: 12px;
  color: var(--c-text-3);
}

.cat-bar {
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--c-bg-mute);
}

.cat-bar i {
  display: block;
  height: 100%;
  border-radius: 4px;
}

.cat-bar i.good {
  background: var(--st-mastered);
}

.cat-bar i.ok {
  background: var(--st-fuzzy);
}

.cat-bar i.bad {
  background: var(--st-weak);
}

.cats b {
  text-align: right;
}

.items ol {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--c-divider);
}

.item-row {
  border-bottom: 1px solid var(--c-divider);
}

.item-head {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 4px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.item-head:disabled {
  cursor: default;
}

.item-no {
  flex: none;
  width: 22px;
  font-family: var(--font-mono);
  color: var(--c-text-3);
}

.item-title {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-weight: 600;
}

.item-title small {
  font-size: 12px;
  font-weight: 400;
  color: var(--c-text-3);
}

.item-rounds {
  display: flex;
  flex: none;
  gap: 6px;
}

.tag-skip {
  padding: 2px 8px;
  border-radius: var(--r-full);
  background: var(--c-bg-mute);
  font-size: 12px;
  color: var(--c-text-2);
}

.item-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 4px 20px 40px;
}

.item-detail .q {
  margin: 0;
  font-weight: 600;
}

.item-detail .a {
  margin: 0;
  color: var(--c-text-2);
  white-space: pre-wrap;
}

.item-detail :deep(.feedback) {
  margin-left: 0;
}

.item-link {
  font-size: 13px;
}

.points {
  padding: 12px 16px;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
  font-size: 13px;
  color: var(--c-text-2);
}

.points p {
  margin: 0 0 4px;
  font-weight: 600;
}

.points ul {
  margin: 0;
  padding-left: 18px;
}

.to-review li .custom-title {
  font-size: inherit;
  color: var(--c-text-1);
}

.to-review li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 16px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--c-divider);
}

.to-review li > span:not(.custom-title) {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.again {
  margin-top: 40px;
  text-align: center;
}

@media (max-width: 640px) {
  .stage {
    padding: 18px 14px 20px;
  }

  .bubble {
    max-width: 92%;
  }

  .cats li {
    grid-template-columns: 110px 1fr 32px;
  }

  .item-detail {
    padding-left: 4px;
  }
}
</style>
