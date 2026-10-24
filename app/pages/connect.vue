<script setup lang="ts">
import type { ApiTokenView } from '#shared/types/token'

useHead({ title: '接入 AI 工具' })

const { loggedIn } = useUserSession()
// 部署在 Caddy 后面：服务端渲染时按 X-Forwarded-* 取 https 和域名，和浏览器里看到的一致
const origin = useRequestURL({ xForwardedHost: true, xForwardedProto: true }).origin
const endpoint = `${origin}/mcp`

const TOOLS = [
  { name: 'search_handbook', desc: '检索手册里的相关段落，回答时带出处链接', write: false },
  { name: 'find_questions', desc: '按关键词、分类、难度找题，附带你的掌握程度', write: false },
  { name: 'get_question', desc: '查看完整解析，以及你的笔记和下次复习时间', write: false },
  { name: 'pick_quiz_questions', desc: '按薄弱点和到期复习抽题（不含答案）', write: false },
  { name: 'get_learning_profile', desc: '各分类掌握情况、AI 面试平均分、最近的低分题', write: false },
  { name: 'get_due_reviews', desc: '今天到期该复习的题', write: false },
  { name: 'record_result', desc: '记录答题得分，更新复习计划', write: true },
]

const EXAMPLES = ['抽 3 道我薄弱的 Redis 题考我', '今天该复习哪些题？一道一道考我', '根据手册讲讲 MySQL 的 MVCC，并给出处']

const EXPIRY = [
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 365, label: '1 年' },
  { value: 0, label: '不过期' },
] as const

const { data: tokens, refresh } = useFetch<ApiTokenView[]>('/api/tokens', { default: () => [], immediate: loggedIn.value })
watch(loggedIn, (v) => v && refresh())

const form = reactive({ name: 'Claude Code', scope: 'write' as 'read' | 'write', expiresInDays: 90 as 0 | 30 | 90 | 365 })
const creating = ref(false)
const errorMsg = ref('')
/** 刚创建的令牌明文：只在这次显示，刷新页面就没了 */
const fresh = ref<string | null>(null)

async function create() {
  creating.value = true
  errorMsg.value = ''
  try {
    const res = await $fetch<ApiTokenView & { token: string }>('/api/tokens', { method: 'POST', body: form })
    fresh.value = res.token
    await refresh()
  } catch (error: any) {
    errorMsg.value = error?.data?.message ?? '创建失败，请稍后再试'
  } finally {
    creating.value = false
  }
}

async function revoke(t: ApiTokenView) {
  if (!confirm(`撤销"${t.name}"吗？用这个令牌的 AI 工具会立刻连不上。`)) return
  await $fetch(`/api/tokens/${t.id}`, { method: 'DELETE' })
  await refresh()
}

const tokenText = computed(() => fresh.value ?? 'mbk_你的令牌')
const CLIENTS = ['Claude Code', 'Cursor', '其他客户端'] as const
const client = ref<(typeof CLIENTS)[number]>('Claude Code')
const snippet = computed(() => {
  if (client.value === 'Claude Code') return `claude mcp add --transport http mianbook ${endpoint} --header "Authorization: Bearer ${tokenText.value}"`
  if (client.value === 'Cursor') {
    return JSON.stringify({ mcpServers: { mianbook: { url: endpoint, headers: { Authorization: `Bearer ${tokenText.value}` } } } }, null, 2)
  }
  return `地址：${endpoint}\n传输方式：Streamable HTTP\n请求头：Authorization: Bearer ${tokenText.value}`
})
const snippetHint = computed(
  () =>
    ({
      'Claude Code': '在终端里执行。加上 --scope user 可以在所有项目里使用；之后在 Claude Code 里输入 /mcp 查看连接状态。',
      Cursor: '写进 ~/.cursor/mcp.json（所有项目）或项目里的 .cursor/mcp.json，然后在 Cursor 设置的 MCP 页面打开它。',
      其他客户端: '支持 Streamable HTTP 和自定义请求头的 MCP 客户端都可以连接。',
    })[client.value],
)

const copied = ref('')
async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => copied.value === key && (copied.value = ''), 1500)
  } catch {
    ElMessage.error('复制失败，请手动选中复制')
  }
}

const formatDate = (iso: string | null, empty = '—') => (iso ? new Date(iso).toLocaleDateString('zh-CN') : empty)
</script>

<template>
  <div class="page container">
    <header class="page-head">
      <p class="eyebrow">MCP · 接入 AI 工具</p>
      <h1 class="serif">在 AI 工具里用手册</h1>
      <p class="sub">
        通过 MCP（Model Context Protocol），Claude Code、Cursor 这类 AI 工具可以直接检索手册、按你的薄弱点抽题考你，并把答题结果写回复习计划。
      </p>
    </header>

    <section class="card block">
      <h2 class="serif">能做什么</h2>
      <p class="muted small">连接之后，直接在 AI 工具里这样说：</p>
      <ul class="examples">
        <li v-for="e in EXAMPLES" :key="e">"{{ e }}"</li>
      </ul>
      <p class="muted small">
        Claude Code 里还可以用现成的提示词：<code>/mcp__mianbook__quiz Redis 3</code>（考我几道题）、<code>/mcp__mianbook__review_today</code>（今日复习）、<code>/mcp__mianbook__explain</code>（用手册回答）。
      </p>
      <ul class="tools">
        <li v-for="t in TOOLS" :key="t.name">
          <code>{{ t.name }}</code>
          <span>{{ t.desc }}</span>
          <span class="tag" :class="{ write: t.write }">{{ t.write ? '写入' : '只读' }}</span>
        </li>
      </ul>
    </section>

    <div v-if="!loggedIn" class="notice card">
      <p>创建访问令牌需要先登录。AI 工具用令牌代表你访问题库和你自己的学习记录。</p>
      <NuxtLink to="/login?redirect=/connect" class="btn btn-primary">登录</NuxtLink>
    </div>

    <template v-else>
      <section class="card block">
        <h2 class="serif">1. 创建访问令牌</h2>
        <form class="create" @submit.prevent="create">
          <label class="field">
            <span class="label">名字</span>
            <input v-model="form.name" class="text-input" maxlength="64" placeholder="比如：笔记本上的 Claude Code" required>
          </label>
          <div class="field">
            <span class="label">权限</span>
            <div class="segmented" role="radiogroup" aria-label="权限">
              <button type="button" role="radio" :aria-checked="form.scope === 'write'" @click="form.scope = 'write'">可记录答题结果</button>
              <button type="button" role="radio" :aria-checked="form.scope === 'read'" @click="form.scope = 'read'">只读</button>
            </div>
          </div>
          <div class="field">
            <span class="label">有效期</span>
            <div class="segmented" role="radiogroup" aria-label="有效期">
              <button v-for="e in EXPIRY" :key="e.value" type="button" role="radio" :aria-checked="form.expiresInDays === e.value" @click="form.expiresInDays = e.value">
                {{ e.label }}
              </button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary" :disabled="creating || !form.name.trim()">{{ creating ? '创建中…' : '创建令牌' }}</button>
        </form>
        <p v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</p>

        <div v-if="fresh" class="fresh" role="status">
          <p class="fresh-title">令牌已创建，只显示这一次，请现在复制保存</p>
          <div class="code-line">
            <code>{{ fresh }}</code>
            <button type="button" class="btn btn-sm" @click="copy(fresh, 'token')">{{ copied === 'token' ? '已复制' : '复制' }}</button>
          </div>
        </div>
      </section>

      <section class="card block">
        <h2 class="serif">2. 配置 AI 工具</h2>
        <div class="segmented" role="tablist" aria-label="客户端">
          <button v-for="c in CLIENTS" :key="c" type="button" role="tab" :aria-checked="client === c" :aria-selected="client === c" @click="client = c">{{ c }}</button>
        </div>
        <div class="snippet">
          <pre><code>{{ snippet }}</code></pre>
          <button type="button" class="btn btn-sm copy" @click="copy(snippet, 'snippet')">{{ copied === 'snippet' ? '已复制' : '复制' }}</button>
        </div>
        <p class="muted small">
          {{ snippetHint }}<template v-if="!fresh">先在上面创建令牌，这里会自动填好。</template>
        </p>
      </section>

      <section class="card block">
        <h2 class="serif">我的令牌</h2>
        <p v-if="!tokens.length" class="muted small">还没有令牌。</p>
        <ul v-else class="tokens">
          <li v-for="t in tokens" :key="t.id">
            <div class="token-main">
              <b>{{ t.name }}</b>
              <span class="tag" :class="{ write: t.scope === 'write' }">{{ t.scope === 'write' ? '可记录答题' : '只读' }}</span>
              <code class="prefix">{{ t.prefix }}…</code>
            </div>
            <span class="token-meta">
              创建于 {{ formatDate(t.createdAt) }} · 最近使用 {{ formatDate(t.lastUsedAt, '从未') }} · {{ t.expiresAt ? `${formatDate(t.expiresAt)} 过期` : '不过期' }}
            </span>
            <button type="button" class="btn btn-sm btn-ghost revoke" @click="revoke(t)">撤销</button>
          </li>
        </ul>
        <p class="muted small note">
          令牌代表你的账号访问题库和你的学习记录，不要提交到代码仓库或发给别人；泄露了就在这里撤销再新建。服务器只保存令牌的哈希，丢了只能重新创建。每个令牌每分钟最多 60 次请求。
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 860px;
  padding-top: 48px;
  padding-bottom: 80px;
}

.page-head h1 {
  margin: 10px 0 0;
  font-size: clamp(30px, 4vw, 42px);
  font-weight: 800;
}

.sub {
  max-width: 660px;
  margin: 10px 0 0;
  color: var(--c-text-2);
}

.block {
  margin-top: 24px;
  padding: 22px 24px;
}

.block h2 {
  margin: 0 0 12px;
  font-size: 19px;
  font-weight: 700;
}

.small {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.7;
}

.small code,
.tools code {
  font-family: var(--font-mono);
  font-size: 12.5px;
}

.examples {
  display: grid;
  gap: 6px;
  margin: 10px 0 12px;
  padding: 0;
  list-style: none;
}

.examples li {
  padding: 8px 12px;
  border-left: 3px solid var(--ai-via);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  background: var(--ai-soft);
  font-size: 14px;
}

.tools {
  display: grid;
  gap: 2px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.tools li {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--c-divider);
  font-size: 13.5px;
}

.tools li span:not(.tag) {
  color: var(--c-text-2);
}

.tag.write {
  background: var(--c-brand-soft);
  color: var(--c-brand);
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

.create {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px 18px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text-2);
}

.text-input {
  width: 240px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg);
  color: var(--c-text-1);
  font: inherit;
  font-size: 14px;
}

.text-input:focus {
  border-color: var(--c-brand);
  outline: none;
}

.segmented {
  display: inline-flex;
  flex-wrap: wrap;
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

.error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--c-danger);
}

.fresh {
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--c-success) 45%, var(--c-divider));
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--c-success) 8%, var(--c-bg-elv));
}

.fresh-title {
  margin: 0 0 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--c-success);
}

.code-line {
  display: flex;
  align-items: center;
  gap: 10px;
}

.code-line code {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--c-bg);
  font-family: var(--font-mono);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.snippet {
  position: relative;
  margin-top: 12px;
}

.snippet pre {
  margin: 0;
  padding: 14px 16px;
  padding-right: 76px;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.snippet code {
  font-family: var(--font-mono);
}

.copy {
  position: absolute;
  top: 10px;
  right: 10px;
}

.tokens {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tokens li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 12px;
  padding: 12px 0;
  border-top: 1px solid var(--c-divider);
}

.tokens li:first-child {
  border-top: 0;
}

.token-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.prefix {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--c-text-3);
}

.token-meta {
  grid-column: 1;
  font-size: 12.5px;
  color: var(--c-text-3);
}

.revoke {
  grid-row: 1 / span 2;
  grid-column: 2;
  align-self: center;
}

.note {
  margin-top: 14px;
}

@media (max-width: 640px) {
  .page {
    padding-top: 28px;
  }

  .block {
    padding: 18px 16px;
  }

  .tools li {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .tools li span:not(.tag) {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .text-input {
    width: 100%;
  }

  .field {
    width: 100%;
  }
}
</style>
