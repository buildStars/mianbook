<script setup lang="ts">
import type { AgentSessionSummary } from '#shared/types/agent'
import type { MockDifficulty, MockSessionSummary } from '#shared/types/handbook'

useHead({ title: '模拟面试 | 全栈面试手册' })

interface AiStatus {
  enabled: boolean
  model: string
  remaining: number
  extraHosts: string[]
  allowUserKey: boolean
}

const { loggedIn } = useUserSession()
const { outline } = useOutline()
const { hasKey: hasStoredKey, config: aiKey, headersFor } = useAiKey()
const { data: ai } = useFetch<AiStatus>('/api/ai/status', { key: 'ai-status' })
/** 后台可能关闭了"用户自带 Key"，这时即使浏览器里存着 Key 也不用 */
const hasKey = computed(() => hasStoredKey.value && ai.value?.allowUserKey !== false)
const allowOwnKey = computed(() => ai.value?.allowUserKey !== false)
const showSettings = ref(false)

const form = reactive({
  track: MOCK_TRACKS[0]!.id,
  categoryIds: [] as number[],
  difficulty: 'mixed' as MockDifficulty,
  count: 8,
  followUps: 1,
  preferWeak: true,
})
// 从进度页"针对练一场"过来时带着分类 id，直接切到自选分类
const route = useRoute()
const presetIds = String(route.query.categories ?? '')
  .split(',')
  .map(Number)
  .filter((n) => Number.isInteger(n) && n > 0)
if (presetIds.length) {
  form.track = 'custom'
  form.categoryIds = presetIds
  form.preferWeak = true
}

const FOLLOW_UPS = [
  { value: 0, label: '不追问' },
  { value: 1, label: '追问 1 次' },
  { value: 2, label: '追问 2 次' },
]

const history = ref<MockSessionSummary[]>([])
const active = computed(() => history.value.find((s) => s.status === 'active') ?? null)
const finishedList = computed(() => history.value.filter((s) => s.status === 'finished'))

const agentHistory = ref<AgentSessionSummary[]>([])

async function loadHistory() {
  if (!loggedIn.value) return
  ;[history.value, agentHistory.value] = await Promise.all([
    $fetch<MockSessionSummary[]>('/api/mock').catch(() => []),
    $fetch<AgentSessionSummary[]>('/api/agent').catch(() => []),
  ])
}
onMounted(loadHistory)
watch(loggedIn, loadHistory)

const canUse = computed(() => hasKey.value || Boolean(ai.value?.enabled))
/** 出题方式：按方向从题库抽、按简历出项目深挖题，或者让 Agent 面试官自己决定 */
const mode = ref<'bank' | 'resume' | 'agent'>(route.query.mode === 'agent' ? 'agent' : 'bank')
const agentForm = reactive({ goal: '', maxQuestions: 5 })
const resumeForm = reactive({ resume: '', role: '', projectCount: 4, bankCount: 3, followUps: 1 })

/** 每题 1 轮加追问次数，结束后再生成 1 次总结；按简历出题还要多 1 次出题；Agent 面试每回答一次算 1 次，再加开场 */
const estimate = computed(() =>
  mode.value === 'bank'
    ? form.count * (1 + form.followUps) + 1
    : mode.value === 'resume'
      ? (resumeForm.projectCount + resumeForm.bankCount) * (1 + resumeForm.followUps) + 2
      : agentForm.maxQuestions + 1,
)
const perQuestion = computed(() => 1 + (mode.value === 'bank' ? form.followUps : resumeForm.followUps))
const custom = computed(() => form.track === 'custom')

function toggleCategory(id: number) {
  const i = form.categoryIds.indexOf(id)
  if (i >= 0) form.categoryIds.splice(i, 1)
  else form.categoryIds.push(id)
}

const starting = ref(false)
const errorMsg = ref('')
async function start() {
  if (starting.value) return
  if (custom.value && !form.categoryIds.length) {
    errorMsg.value = '请至少选择一个分类'
    return
  }
  starting.value = true
  errorMsg.value = ''
  try {
    const { id } = await $fetch<{ id: number }>('/api/mock', { method: 'POST', body: { ...form } })
    await navigateTo(`/mock/${id}`)
  } catch (error: any) {
    errorMsg.value = error?.data?.message ?? '创建失败，请稍后再试'
  } finally {
    starting.value = false
  }
}

async function startResume() {
  if (starting.value) return
  if (resumeForm.resume.trim().length < 50) {
    errorMsg.value = '简历或项目描述至少写 50 个字'
    return
  }
  starting.value = true
  errorMsg.value = ''
  try {
    // 出题要调用大模型，带上用户自己的 Key（如果填了）
    const { id } = await $fetch<{ id: number }>('/api/mock/resume', {
      method: 'POST',
      body: { ...resumeForm },
      headers: headersFor(),
      timeout: 150_000,
    })
    resumeForm.resume = ''
    await navigateTo(`/mock/${id}`)
  } catch (error: any) {
    errorMsg.value = error?.data?.message ?? '出题失败，请稍后再试'
  } finally {
    starting.value = false
  }
}

async function startAgent() {
  if (starting.value) return
  if (agentForm.goal.trim().length < 4) {
    errorMsg.value = '写一下面试目标，比如岗位、公司和想重点准备的方向'
    return
  }
  starting.value = true
  errorMsg.value = ''
  try {
    const { id } = await $fetch<{ id: number }>('/api/agent', { method: 'POST', body: { ...agentForm } })
    await navigateTo(`/mock/agent/${id}`)
  } catch (error: any) {
    errorMsg.value = error?.data?.message ?? '创建失败，请稍后再试'
  } finally {
    starting.value = false
  }
}

async function removeAgent(item: AgentSessionSummary) {
  if (!confirm('删除这场 Agent 面试吗？已经写进复习计划的得分会保留。')) return
  await $fetch(`/api/agent/${item.id}`, { method: 'DELETE' })
  agentHistory.value = agentHistory.value.filter((s) => s.id !== item.id)
}

async function remove(item: MockSessionSummary) {
  if (!confirm(`删除"${item.title}"这场面试吗？每道题的面试记录仍会保留在题目页。`)) return
  await $fetch(`/api/mock/${item.id}`, { method: 'DELETE' })
  history.value = history.value.filter((s) => s.id !== item.id)
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const scoreLevel = (s: number | null) => (s === null ? '' : s >= 8 ? 'good' : s >= 5 ? 'ok' : 'bad')
</script>

<template>
  <div class="page container">
    <header class="page-head">
      <p class="eyebrow">MOCK INTERVIEW · 模拟面试</p>
      <h1 class="serif">整场模拟面试</h1>
      <p class="sub">选一个方向，AI 面试官连续提问。每道题打分、追问，结束后给出总结和复习建议，低分的题自动加入复习计划。</p>
    </header>

    <div v-if="!loggedIn" class="notice card">
      <p>模拟面试需要登录，面试记录和复习计划都保存在账号里。</p>
      <NuxtLink to="/login?redirect=/mock" class="btn btn-primary">登录</NuxtLink>
    </div>

    <template v-else>
      <NuxtLink v-if="active" :to="`/mock/${active.id}`" class="resume card">
        <span class="resume-dot" aria-hidden="true" />
        <span class="resume-text">
          <b>有一场面试还没结束</b>
          <span>{{ active.title }} · 已答 {{ active.answered }} / {{ active.count }} 题</span>
        </span>
        <span class="btn btn-sm btn-primary">继续面试</span>
      </NuxtLink>

      <section class="setup card">
        <div class="segmented mode" role="tablist" aria-label="出题方式">
          <button type="button" role="tab" :aria-checked="mode === 'bank'" :aria-selected="mode === 'bank'" @click="mode = 'bank'">按方向出题</button>
          <button type="button" role="tab" :aria-checked="mode === 'resume'" :aria-selected="mode === 'resume'" @click="mode = 'resume'">按简历出题</button>
          <button type="button" role="tab" :aria-checked="mode === 'agent'" :aria-selected="mode === 'agent'" @click="mode = 'agent'">Agent 面试官</button>
        </div>

        <template v-if="mode === 'bank'">
        <div class="field">
          <p class="label">面试方向</p>
          <div class="tracks" role="radiogroup" aria-label="面试方向">
            <button
              v-for="t in MOCK_TRACKS"
              :key="t.id"
              type="button"
              role="radio"
              class="track"
              :aria-checked="form.track === t.id"
              @click="form.track = t.id"
            >
              <b>{{ t.name }}</b>
              <span>{{ t.desc }}</span>
            </button>
            <button type="button" role="radio" class="track" :aria-checked="custom" @click="form.track = 'custom'">
              <b>自选分类</b>
              <span>从题库里挑几个分类</span>
            </button>
          </div>
        </div>

        <div v-if="custom" class="field">
          <p class="label">选择分类 <span class="muted">（已选 {{ form.categoryIds.length }} 个）</span></p>
          <div v-for="p in outline" :key="p.id" class="cat-group">
            <span class="cat-part">{{ p.title }}</span>
            <div class="chips">
              <button
                v-for="c in p.categories"
                :key="c.id"
                type="button"
                class="cat-chip"
                :aria-pressed="form.categoryIds.includes(c.id)"
                @click="toggleCategory(c.id)"
              >
                {{ c.title }}
              </button>
            </div>
          </div>
        </div>

        <div class="row">
          <div class="field">
            <p class="label">难度</p>
            <div class="segmented" role="radiogroup" aria-label="难度">
              <button
                v-for="d in MOCK_DIFFICULTIES"
                :key="d.value"
                type="button"
                role="radio"
                :aria-checked="form.difficulty === d.value"
                :title="d.desc"
                @click="form.difficulty = d.value"
              >
                {{ d.label }}
              </button>
            </div>
          </div>
          <div class="field">
            <p class="label">题数</p>
            <div class="segmented" role="radiogroup" aria-label="题数">
              <button v-for="n in MOCK_COUNTS" :key="n" type="button" role="radio" :aria-checked="form.count === n" @click="form.count = n">
                {{ n }} 题
              </button>
            </div>
          </div>
          <div class="field">
            <p class="label">每题追问</p>
            <div class="segmented" role="radiogroup" aria-label="每题追问">
              <button
                v-for="f in FOLLOW_UPS"
                :key="f.value"
                type="button"
                role="radio"
                :aria-checked="form.followUps === f.value"
                @click="form.followUps = f.value"
              >
                {{ f.label }}
              </button>
            </div>
          </div>
        </div>

        <button type="button" role="switch" class="switch" :aria-checked="form.preferWeak" @click="form.preferWeak = !form.preferWeak">
          <span class="switch-track" />优先抽不会、模糊和今天该复习的题
        </button>
        </template>

        <template v-else-if="mode === 'agent'">
          <div class="field">
            <p class="label">面试目标</p>
            <textarea
              v-model="agentForm.goal"
              class="resume-input"
              aria-label="面试目标"
              rows="3"
              maxlength="500"
              placeholder="例如：下周面字节跳动前端二面，React 和性能优化是重点，算法一般"
            />
          </div>
          <div class="row">
            <div class="field">
              <p class="label">主问题数量</p>
              <div class="segmented" role="radiogroup" aria-label="主问题数量">
                <button v-for="n in [3, 5, 8]" :key="n" type="button" role="radio" :aria-checked="agentForm.maxQuestions === n" @click="agentForm.maxQuestions = n">{{ n }} 道</button>
              </div>
            </div>
          </div>
          <p class="hint">
            面试官是一个会调用工具的 AI Agent：先看你的学习记录和薄弱点，再按目标从题库里找题；每次回答后自己查参考答案打分，决定追问还是换题，答得好就加难度，答不上来就换个更基础的。主问题的得分会写进复习计划。
          </p>
        </template>

        <template v-else>
          <div class="field">
            <p class="label">简历或项目经历</p>
            <textarea
              v-model="resumeForm.resume"
              class="resume-input"
              rows="10"
              maxlength="8000"
              placeholder="粘贴简历里的项目经历部分即可：做过什么项目、负责哪块、用了哪些技术、解决了什么问题、取得了什么结果……"
            />
            <p class="hint">
              {{ resumeForm.resume.length }}/8000 · 简历只用于这一次出题，不会保存到服务器，但会发给 AI 服务商处理。建议先删掉姓名、电话、邮箱、公司名等个人信息。
            </p>
          </div>
          <div class="row">
            <div class="field grow">
              <p class="label">目标岗位 <span class="muted">（可选）</span></p>
              <input v-model="resumeForm.role" class="text-input" maxlength="60" placeholder="例如：高级前端工程师、Go 后端" />
            </div>
          </div>
          <div class="row">
            <div class="field">
              <p class="label">项目深挖题</p>
              <div class="segmented" role="radiogroup" aria-label="项目深挖题数量">
                <button v-for="n in [3, 4, 6]" :key="n" type="button" role="radio" :aria-checked="resumeForm.projectCount === n" @click="resumeForm.projectCount = n">{{ n }} 道</button>
              </div>
            </div>
            <div class="field">
              <p class="label">相关基础题</p>
              <div class="segmented" role="radiogroup" aria-label="相关基础题数量">
                <button v-for="n in [0, 3, 5]" :key="n" type="button" role="radio" :aria-checked="resumeForm.bankCount === n" @click="resumeForm.bankCount = n">{{ n ? `${n} 道` : '不要' }}</button>
              </div>
            </div>
            <div class="field">
              <p class="label">每题追问</p>
              <div class="segmented" role="radiogroup" aria-label="每题追问">
                <button v-for="f in FOLLOW_UPS" :key="f.value" type="button" role="radio" :aria-checked="resumeForm.followUps === f.value" @click="resumeForm.followUps = f.value">{{ f.label }}</button>
              </div>
            </div>
          </div>
          <p class="hint">AI 先读简历，针对你的项目出题（先介绍项目，再深挖方案、难点和取舍）；同时识别简历里的技术栈，从题库对应分类补几道基础题。</p>
        </template>

        <InterviewAiSettings v-if="showSettings" class="settings" :extra-hosts="ai?.extraHosts ?? []" @close="showSettings = false" @saved="showSettings = false" />

        <div class="start">
          <p class="cost">
            <template v-if="mode === 'agent'">预计约 <b>{{ estimate }}</b> 次 AI 次数（每回答一次算 1 次，追问另算）。</template>
            <template v-else>预计调用大模型约 <b>{{ estimate }}</b> 次（每题 {{ perQuestion }} 次，加 1 次总结<template v-if="mode === 'resume'">和 1 次出题</template>）。</template>
            <template v-if="hasKey">使用你自己的 Key（{{ aiKey?.model }}），不限次数。</template>
            <template v-else-if="ai?.enabled">今天还剩 {{ ai.remaining }} 次，不够时可以中途停下，下次接着答。</template>
            <template v-else>站点没有配置 AI 服务，需要填写你自己的 API Key。</template>
            <button v-if="allowOwnKey" type="button" class="link-btn" @click="showSettings = !showSettings">{{ hasKey ? 'AI 设置' : '用自己的 Key' }}</button>
          </p>
          <button
            type="button"
            class="btn btn-ai btn-lg"
            :disabled="starting || !canUse"
            @click="mode === 'bank' ? start() : mode === 'resume' ? startResume() : startAgent()"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>
            <template v-if="mode === 'bank'">{{ starting ? '正在抽题…' : '开始面试' }}</template>
            <template v-else-if="mode === 'agent'">{{ starting ? '正在准备…' : '开始 Agent 面试' }}</template>
            <template v-else>{{ starting ? 'AI 正在读简历、出题…' : 'AI 出题并开始' }}</template>
          </button>
        </div>
        <p v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</p>
      </section>

      <section v-if="mode === 'agent' && agentHistory.length" class="history">
        <h2 class="serif">Agent 面试记录</h2>
        <ul>
          <li v-for="s in agentHistory" :key="s.id" class="history-row">
            <NuxtLink :to="`/mock/agent/${s.id}`" class="history-main">
              <span class="history-title">{{ s.goal }}</span>
              <span class="history-meta">
                {{ formatTime(s.createdAt) }} · 问了 {{ s.asked }} / {{ s.maxQuestions }} 题{{ s.status === 'active' ? ' · 进行中' : '' }}
              </span>
            </NuxtLink>
            <span class="history-score" :class="scoreLevel(s.score)">{{ s.score ?? '—' }}<small v-if="s.score !== null"> 分</small></span>
            <button type="button" class="icon-btn" aria-label="删除这场面试" @click="removeAgent(s)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
            </button>
          </li>
        </ul>
      </section>

      <section v-if="finishedList.length && mode !== 'agent'" class="history">
        <h2 class="serif">面试记录</h2>
        <ul>
          <li v-for="s in finishedList" :key="s.id" class="history-row">
            <NuxtLink :to="`/mock/${s.id}`" class="history-main">
              <span class="history-title">{{ s.title }}</span>
              <span class="history-meta">{{ formatTime(s.createdAt) }} · 答了 {{ s.answered }} / {{ s.count }} 题</span>
            </NuxtLink>
            <span class="history-score" :class="scoreLevel(s.score)">{{ s.score ?? '—' }}<small v-if="s.score !== null"> 分</small></span>
            <button type="button" class="icon-btn" aria-label="删除这场面试" @click="remove(s)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
            </button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 920px;
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

.resume {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 28px;
  padding: 16px 20px;
  color: inherit;
  border-color: color-mix(in srgb, var(--c-brand) 40%, var(--c-divider));
}

.resume-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c-brand);
  box-shadow: 0 0 0 4px var(--c-brand-soft);
}

.resume-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: var(--c-text-2);
}

.resume-text b {
  font-size: 15px;
  color: var(--c-text-1);
}

.setup {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 28px;
  padding: 28px 30px;
}

.label {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--c-text-1);
}

.tracks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}

.track {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg);
  color: var(--c-text-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}

.track span {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.track:hover {
  border-color: var(--c-border);
}

.track[aria-checked='true'] {
  border-color: var(--c-brand);
  box-shadow: 0 0 0 1px var(--c-brand);
  background: var(--c-brand-softer);
}

.cat-group {
  display: flex;
  gap: 12px;
  margin-top: 10px;
}

.cat-part {
  flex: none;
  width: 92px;
  padding-top: 5px;
  font-size: 12.5px;
  color: var(--c-text-3);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cat-chip {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-full);
  background: var(--c-bg);
  color: var(--c-text-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.cat-chip[aria-pressed='true'] {
  border-color: var(--c-brand);
  background: var(--c-brand-soft);
  color: var(--c-brand);
  font-weight: 600;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 24px 32px;
}

.segmented {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--r-md);
  background: var(--c-bg-mute);
}

.segmented button {
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: calc(var(--r-md) - 2px);
  background: none;
  color: var(--c-text-2);
  font: inherit;
  font-size: 13.5px;
  cursor: pointer;
}

.segmented button[aria-checked='true'] {
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-xs);
  color: var(--c-text-1);
  font-weight: 600;
}

.switch {
  align-self: flex-start;
}

.mode {
  align-self: flex-start;
}

.resume-input,
.text-input {
  width: 100%;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg);
  color: var(--c-text-1);
  font: inherit;
}

.resume-input {
  padding: 14px 16px;
  line-height: 1.7;
  resize: vertical;
}

.text-input {
  height: 38px;
  padding: 0 12px;
}

.resume-input:focus-visible,
.text-input:focus-visible {
  outline: 2px solid var(--c-brand);
  outline-offset: -1px;
}

.hint {
  margin: 8px 0 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-3);
}

.grow {
  flex: 1 1 320px;
}

.settings {
  margin: 0;
}

.start {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 20px;
  border-top: 1px solid var(--c-divider);
}

.cost {
  flex: 1 1 360px;
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--c-text-2);
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

.error {
  margin: -8px 0 0;
  color: var(--st-weak-text);
}

.history {
  margin-top: 48px;
}

.history h2 {
  margin: 0 0 14px;
  font-size: 22px;
  font-weight: 800;
}

.history ul {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--c-divider);
}

.history-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 4px;
  border-bottom: 1px solid var(--c-divider);
}

.history-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  color: inherit;
}

.history-title {
  font-weight: 600;
}

.history-main:hover .history-title {
  color: var(--c-brand);
}

.history-meta {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.history-score {
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 800;
  color: var(--c-text-3);
}

.history-score small {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
}

.history-score.good {
  color: var(--st-mastered-text);
}

.history-score.ok {
  color: var(--st-fuzzy-text);
}

.history-score.bad {
  color: var(--st-weak-text);
}

.icon-btn {
  display: inline-flex;
  padding: 8px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  color: var(--c-text-3);
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--c-bg-mute);
  color: var(--st-weak-text);
}

@media (max-width: 640px) {
  .setup {
    padding: 22px 18px;
  }

  .cat-group {
    flex-direction: column;
    gap: 6px;
  }

  .segmented {
    display: flex;
  }

  .segmented button {
    flex: 1;
    padding: 0 8px;
  }
}
</style>
