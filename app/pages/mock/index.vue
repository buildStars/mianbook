<script setup lang="ts">
import type { MockDifficulty, MockSessionSummary } from '#shared/types/handbook'

useHead({ title: '模拟面试 | 全栈面试手册' })

interface AiStatus {
  enabled: boolean
  model: string
  remaining: number
  extraHosts: string[]
}

const { loggedIn } = useUserSession()
const { outline } = useOutline()
const { hasKey, config: aiKey } = useAiKey()
const { data: ai } = useFetch<AiStatus>('/api/ai/status', { key: 'ai-status' })
const showSettings = ref(false)

const form = reactive({
  track: MOCK_TRACKS[0]!.id,
  categoryIds: [] as number[],
  difficulty: 'mixed' as MockDifficulty,
  count: 8,
  followUps: 1,
  preferWeak: true,
})
const FOLLOW_UPS = [
  { value: 0, label: '不追问' },
  { value: 1, label: '追问 1 次' },
  { value: 2, label: '追问 2 次' },
]

const history = ref<MockSessionSummary[]>([])
const active = computed(() => history.value.find((s) => s.status === 'active') ?? null)
const finishedList = computed(() => history.value.filter((s) => s.status === 'finished'))

async function loadHistory() {
  if (!loggedIn.value) return
  history.value = await $fetch<MockSessionSummary[]>('/api/mock').catch(() => [])
}
onMounted(loadHistory)
watch(loggedIn, loadHistory)

const canUse = computed(() => hasKey.value || Boolean(ai.value?.enabled))
/** 每题 1 轮加追问次数，结束后再生成 1 次总结 */
const estimate = computed(() => form.count * (1 + form.followUps) + 1)
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

        <InterviewAiSettings v-if="showSettings" class="settings" :extra-hosts="ai?.extraHosts ?? []" @close="showSettings = false" @saved="showSettings = false" />

        <div class="start">
          <p class="cost">
            预计调用大模型约 <b>{{ estimate }}</b> 次（每题 {{ 1 + form.followUps }} 次，加 1 次总结）。
            <template v-if="hasKey">使用你自己的 Key（{{ aiKey?.model }}），不限次数。</template>
            <template v-else-if="ai?.enabled">今天还剩 {{ ai.remaining }} 次，不够时可以中途停下，下次接着答。</template>
            <template v-else>站点没有配置 AI 服务，需要填写你自己的 API Key。</template>
            <button type="button" class="link-btn" @click="showSettings = !showSettings">{{ hasKey ? 'AI 设置' : '用自己的 Key' }}</button>
          </p>
          <button type="button" class="btn btn-ai btn-lg" :disabled="starting || !canUse" @click="start">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>
            {{ starting ? '正在抽题…' : '开始面试' }}
          </button>
        </div>
        <p v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</p>
      </section>

      <section v-if="finishedList.length" class="history">
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
