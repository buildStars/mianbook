<script setup lang="ts">
/** 用户详情抽屉：AI 次数、学习情况、AI 用量、登录安全、访问令牌、停用账号。不显示笔记和回答的内容 */
import type { AdminUserDetail, AdminUserRow } from '#shared/types/admin'

const props = defineProps<{ userId: number | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const { user: me } = useUserSession()
const open = computed({
  get: () => props.userId !== null,
  set: (value) => {
    if (!value) emit('close')
  },
})

const detail = ref<AdminUserDetail | null>(null)
const loadError = ref('')
let seq = 0

async function load() {
  const id = props.userId
  if (id === null) return
  const current = ++seq
  loadError.value = ''
  try {
    const data = await $fetch<AdminUserDetail>(`/api/admin/users/${id}`)
    // 切换得快时，只用最后一次请求的结果
    if (current !== seq) return
    detail.value = data
    resetQuota()
  } catch (error) {
    if (current === seq) loadError.value = errorMessage(error)
  }
}

watch(
  () => props.userId,
  (id) => {
    if (id === null) return
    detail.value = null
    load()
  },
  { immediate: true },
)

const u = computed(() => detail.value?.user ?? null)
const isSelf = computed(() => u.value?.id === me.value?.id)

// ---------- AI 次数 ----------
type QuotaMode = 'default' | 'custom' | 'off'
const quota = reactive({ mode: 'default' as QuotaMode, value: 30 as number | undefined })

function resetQuota() {
  const custom = detail.value?.user.aiLimitCustom ?? null
  quota.mode = custom === null ? 'default' : custom === 0 ? 'off' : 'custom'
  quota.value = custom ? custom : detail.value?.defaultLimit || 30
}

const quotaValue = computed(() => (quota.mode === 'default' ? null : quota.mode === 'off' ? 0 : Math.max(1, Math.round(quota.value ?? 1))))
const quotaDirty = computed(() => Boolean(detail.value) && quotaValue.value !== detail.value!.user.aiLimitCustom)
const quotaHint = computed(() => {
  const d = detail.value
  if (!d) return ''
  if (quota.mode === 'default') return `跟随"AI 设置"里的全站次数，现在是 24 小时 ${d.defaultLimit} 次；全站次数改了，这个用户跟着变`
  if (quota.mode === 'off') return '这个用户不能再用站点的 AI；在 AI 设置里填了自己的 API Key 的话仍然可以用'
  return `这个用户 24 小时内最多用 ${quotaValue.value} 次，不受全站次数影响`
})
const usedPct = computed(() => {
  const x = u.value
  if (!x || !x.aiLimit) return x?.aiUsed24h ? 100 : 0
  return Math.min(100, Math.round((x.aiUsed24h / x.aiLimit) * 100))
})

// ---------- 操作 ----------
const busy = ref<string | null>(null)

async function act(key: string, run: () => Promise<unknown>, success: string) {
  busy.value = key
  try {
    await run()
    ElMessage.success(success)
    emit('changed')
    await load()
  } catch (error) {
    ElMessage.error({ message: errorMessage(error), duration: 6000 })
  } finally {
    busy.value = null
  }
}

async function confirmed(message: string, title: string, confirmButtonText: string, danger = false) {
  try {
    await ElMessageBox.confirm(message, title, {
      type: 'warning',
      confirmButtonText,
      cancelButtonText: '取消',
      ...(danger ? { confirmButtonClass: 'el-button--danger' } : {}),
    })
    return true
  } catch {
    return false
  }
}

function saveQuota() {
  const value = quotaValue.value
  const message = value === null ? '已改为跟随全站设置' : value === 0 ? '已关闭这个用户的站点 AI' : `已设为 24 小时 ${value} 次`
  return act('quota', () => $fetch<AdminUserRow>(`/api/admin/users/${u.value!.id}`, { method: 'PUT', body: { aiDailyLimit: value } }), message)
}

async function toggleDisabled() {
  const x = u.value!
  if (x.disabledAt) {
    return act('disable', () => $fetch<AdminUserRow>(`/api/admin/users/${x.id}`, { method: 'PUT', body: { disabled: false } }), `已重新启用 ${x.name}`)
  }
  const ok = await confirmed(
    `停用后 ${x.name} 不能登录，已登录的设备马上下线，访问令牌暂停使用。学习记录都会保留，随时可以重新启用。`,
    `停用 ${x.name}？`,
    '停用',
    true,
  )
  if (ok) await act('disable', () => $fetch<AdminUserRow>(`/api/admin/users/${x.id}`, { method: 'PUT', body: { disabled: true } }), `已停用 ${x.name}`)
}

async function logoutAll() {
  const x = u.value!
  const ok = await confirmed(`${x.name} 在所有浏览器上的登录都会失效，需要重新登录。访问令牌不受影响。`, '让所有设备下线？', '下线')
  if (ok) await act('logout', () => $fetch<{ ok: boolean }>(`/api/admin/users/${x.id}/logout`, { method: 'POST' }), '已让所有设备下线')
}

function unlock() {
  return act('unlock', () => $fetch<{ ok: boolean }>(`/api/admin/users/${u.value!.id}/unlock`, { method: 'POST' }), '已解除登录锁定')
}

async function sendReset() {
  const x = u.value!
  const ok = await confirmed(
    `会给 ${x.email} 发一封带验证码的邮件，用户在"忘记密码"页面输入验证码后自己设置新密码。重置之前原密码仍然有效。`,
    '发送重置密码邮件？',
    '发送',
  )
  if (ok) await act('reset', () => $fetch<{ to: string }>(`/api/admin/users/${x.id}/reset-password`, { method: 'POST' }), `重置密码邮件已发到 ${x.email}`)
}

async function revokeToken(token: AdminUserDetail['tokens'][number]) {
  const id = u.value!.id
  const ok = await confirmed(`撤销后，用"${token.name}"（${token.prefix}…）的 AI 工具马上不能再访问手册，不能恢复。`, '撤销访问令牌？', '撤销', true)
  if (ok) await act(`token-${token.id}`, () => $fetch<{ ok: boolean }>(`/api/admin/users/${id}/tokens/${token.id}`, { method: 'DELETE' }), `已撤销"${token.name}"`)
}

const STATUS_LABELS = { ok: '正常', aborted: '中途停止', error: '出错' } as const
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('zh-CN')
const expired = (iso: string | null) => Boolean(iso && new Date(iso).getTime() < Date.now())
const tokensOf = (d: AdminUserDetail) => d.ai.promptTokens + d.ai.completionTokens
</script>

<template>
  <ElDrawer v-model="open" size="min(560px, 100vw)" append-to-body class="user-drawer">
    <template #header>
      <div v-if="u" class="head">
        <span class="avatar serif" :class="{ admin: u.role === 'admin' }" aria-hidden="true">{{ u.name.slice(0, 1) }}</span>
        <div class="head-text">
          <h2 class="serif">{{ u.name }}<span v-if="isSelf" class="me">我</span></h2>
          <p>{{ u.email }}</p>
          <div class="chips">
            <span v-if="u.role === 'admin'" class="chip ink">管理员</span>
            <span v-if="u.disabledAt" class="chip bad">已停用</span>
            <span v-if="u.emailVerified" class="chip ok">邮箱已验证</span>
          </div>
        </div>
      </div>
      <h2 v-else class="serif placeholder-title">用户详情</h2>
    </template>

    <div v-if="loadError" class="a-alert bad">
      {{ loadError }}<button type="button" class="a-alert-action link-btn" @click="load">重试</button>
    </div>
    <p v-else-if="!detail || !u" class="a-empty">加载中…</p>
    <div v-else class="body">
      <p class="meta">
        注册于 {{ formatDate(u.createdAt) }} · 最近活跃
        <time v-if="u.lastActiveAt" :datetime="u.lastActiveAt" :title="formatDateTime(u.lastActiveAt)">{{ relativeTime(u.lastActiveAt) }}</time>
        <template v-else>没有记录</template>
      </p>
      <div v-if="u.disabledAt" class="a-alert bad">
        <AdminIcon name="alert" :size="16" />这个账号在 {{ formatDateTime(u.disabledAt) }} 被停用：不能登录，访问令牌暂停使用
      </div>

      <section class="sec" aria-labelledby="sec-quota">
        <header class="sec-head">
          <h3 id="sec-quota">AI 次数</h3>
          <span class="aside">只限制用站点 Key 的调用</span>
        </header>
        <div class="quota-now">
          <span class="a-num big">{{ u.aiUsed24h }}</span>
          <span class="of">{{ u.aiLimitCustom === 0 ? '次' : `/ ${u.aiLimit} 次` }} · 最近 24 小时</span>
          <span v-if="u.aiLimitCustom === 0" class="chip bad">已关闭</span>
          <span v-else-if="u.aiLimitCustom !== null" class="chip">单独设置</span>
        </div>
        <div v-if="u.aiLimitCustom !== 0" class="bar" :class="{ full: usedPct >= 100 }" aria-hidden="true"><i :style="{ width: `${usedPct}%` }" /></div>
        <div class="quota-form">
          <div class="a-seg" role="group" aria-label="AI 次数上限">
            <button type="button" :aria-pressed="quota.mode === 'default'" @click="quota.mode = 'default'">跟随全站（{{ detail.defaultLimit }} 次）</button>
            <button type="button" :aria-pressed="quota.mode === 'custom'" @click="quota.mode = 'custom'">单独设置</button>
            <button type="button" :aria-pressed="quota.mode === 'off'" @click="quota.mode = 'off'">关闭</button>
          </div>
          <ElInputNumber
            v-if="quota.mode === 'custom'"
            v-model="quota.value"
            :min="1"
            :max="10000"
            :step="5"
            controls-position="right"
            aria-label="24 小时次数"
            class="quota-input"
          />
          <button type="button" class="btn btn-sm btn-primary" :disabled="!quotaDirty || busy !== null" @click="saveQuota">
            {{ busy === 'quota' ? '保存中…' : '保存' }}
          </button>
        </div>
        <p class="hint">{{ quotaHint }}</p>
      </section>

      <section class="sec" aria-labelledby="sec-study">
        <header class="sec-head"><h3 id="sec-study">学习情况</h3></header>
        <dl class="stats">
          <div>
            <dt><i class="st mastered" aria-hidden="true" />已掌握</dt>
            <dd class="a-num">{{ detail.study.mastered }}</dd>
          </div>
          <div>
            <dt><i class="st fuzzy" aria-hidden="true" />模糊</dt>
            <dd class="a-num">{{ detail.study.fuzzy }}</dd>
          </div>
          <div>
            <dt><i class="st weak" aria-hidden="true" />薄弱</dt>
            <dd class="a-num">{{ detail.study.weak }}</dd>
          </div>
          <div>
            <dt>收藏 · 笔记</dt>
            <dd class="a-num">{{ detail.study.starred }}<span class="sep">·</span>{{ detail.study.notes }}</dd>
          </div>
          <div>
            <dt>复习卡片</dt>
            <dd class="a-num">{{ detail.study.cards }}<small v-if="detail.study.due">{{ detail.study.due }} 张到期</small></dd>
          </div>
          <div>
            <dt>AI 单题面试</dt>
            <dd class="a-num">{{ detail.practice.interviews }}</dd>
          </div>
          <div>
            <dt>整场模拟面试</dt>
            <dd class="a-num">{{ detail.practice.mocks }}<small v-if="detail.practice.mocks">完成 {{ detail.practice.mocksFinished }}</small></dd>
          </div>
          <div>
            <dt>Agent 面试</dt>
            <dd class="a-num">{{ detail.practice.agents }}</dd>
          </div>
        </dl>
      </section>

      <section class="sec" aria-labelledby="sec-ai">
        <header class="sec-head">
          <h3 id="sec-ai">AI 用量</h3>
          <span class="aside">最近 30 天</span>
        </header>
        <p v-if="!detail.ai.site && !detail.ai.own" class="none">最近 30 天没有用过 AI</p>
        <template v-else>
          <dl class="stats three">
            <div>
              <dt>站点 Key</dt>
              <dd class="a-num">{{ detail.ai.site }}<small>次</small></dd>
            </div>
            <div>
              <dt>自己的 Key</dt>
              <dd class="a-num">{{ detail.ai.own }}<small>次</small></dd>
            </div>
            <div>
              <dt>估算费用</dt>
              <dd v-if="detail.ai.cost" class="a-num">{{ formatMoney(detail.ai.cost) }}</dd>
              <dd v-else class="unset"><NuxtLink to="/admin/ai">设置价格</NuxtLink>后显示</dd>
            </div>
          </dl>
          <p class="hint">站点 Key 用了 {{ compactNumber(tokensOf(detail)) }} token（输入 {{ compactNumber(detail.ai.promptTokens) }}，输出 {{ compactNumber(detail.ai.completionTokens) }}）<template v-if="detail.ai.errors">，出错 {{ detail.ai.errors }} 次（不扣次数）</template></p>
          <table class="mini">
            <thead>
              <tr>
                <th scope="col">功能</th>
                <th scope="col">站点 Key</th>
                <th scope="col">自己的 Key</th>
                <th scope="col">出错</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="k in detail.ai.byKind" :key="k.kind">
                <td>{{ AI_KIND_LABELS[k.kind] }}</td>
                <td class="n a-num">{{ k.site }}</td>
                <td class="n a-num">{{ k.own }}</td>
                <td class="n a-num" :class="{ bad: k.errors }">{{ k.errors }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <template v-if="detail.ai.recent.length">
          <h4 class="sub">最近 {{ detail.ai.recent.length }} 次调用</h4>
          <ul class="calls">
            <li v-for="c in detail.ai.recent" :key="c.id">
              <span class="status" :class="c.status" :title="STATUS_LABELS[c.status]"><i aria-hidden="true" />{{ STATUS_LABELS[c.status] }}</span>
              <span class="what">
                {{ aiKindLabel(c.kind) }}<em v-if="c.kind.endsWith('-own')">自己的 Key</em>
                <span v-if="c.model" class="model a-mono">{{ c.model }}</span>
              </span>
              <span class="cost a-mono">{{ formatMs(c.latencyMs) }}<template v-if="c.tokens !== null"> · {{ compactNumber(c.tokens) }} token</template></span>
              <time :datetime="c.at" :title="formatDateTime(c.at)">{{ relativeTime(c.at) }}</time>
              <p v-if="c.error" class="err">{{ c.error }}</p>
            </li>
          </ul>
        </template>
      </section>

      <section class="sec" aria-labelledby="sec-login">
        <header class="sec-head"><h3 id="sec-login">登录与安全</h3></header>
        <div class="row">
          <div class="label">
            <strong>登录失败
              <span v-if="detail.login.accountLocked" class="chip bad">账号已锁定</span>
              <span v-else-if="detail.login.lockedIps" class="chip warn">{{ detail.login.lockedIps }} 个 IP 被锁</span>
            </strong>
            <span v-if="detail.login.failures" class="desc">
              最近一小时 {{ detail.login.failures }} 次，最近一次在
              <time v-if="detail.login.lastFailureAt" :title="formatDateTime(detail.login.lastFailureAt)">{{ relativeTime(detail.login.lastFailureAt) }}</time>。锁定会自动解除，也可以手动解除
            </span>
            <span v-else class="desc">最近一小时没有登录失败</span>
          </div>
          <button type="button" class="btn btn-sm" :disabled="!detail.login.failures || busy !== null" @click="unlock">
            {{ busy === 'unlock' ? '处理中…' : '解除锁定' }}
          </button>
        </div>
        <div class="row">
          <div class="label">
            <strong>让所有设备下线</strong>
            <span class="desc">{{ isSelf ? '不能让自己下线，请直接退出登录' : '已登录的浏览器都需要重新登录；访问令牌不受影响' }}</span>
          </div>
          <button type="button" class="btn btn-sm" :disabled="isSelf || Boolean(u.disabledAt) || busy !== null" @click="logoutAll">
            {{ busy === 'logout' ? '处理中…' : '强制下线' }}
          </button>
        </div>
        <div class="row">
          <div class="label">
            <strong>重置密码</strong>
            <span class="desc">{{
              !detail.mailConfigured
                ? '需要先配置发信邮箱'
                : '发一封验证码邮件，用户在"忘记密码"页面自己设置新密码；管理员看不到也改不了密码'
            }}</span>
          </div>
          <button type="button" class="btn btn-sm" :disabled="!detail.mailConfigured || Boolean(u.disabledAt) || busy !== null" @click="sendReset">
            {{ busy === 'reset' ? '发送中…' : '发重置邮件' }}
          </button>
        </div>
      </section>

      <section class="sec" aria-labelledby="sec-tokens">
        <header class="sec-head">
          <h3 id="sec-tokens">访问令牌</h3>
          <span class="aside">给 Claude Code、Cursor 这类 AI 工具用的 MCP 令牌</span>
        </header>
        <p v-if="!detail.tokens.length" class="none">没有创建访问令牌</p>
        <ul v-else class="tokens">
          <li v-for="t in detail.tokens" :key="t.id">
            <div class="tk-main">
              <strong>{{ t.name }}</strong>
              <span class="a-mono prefix">{{ t.prefix }}…</span>
              <span class="chip">{{ t.scope === 'write' ? '可记录答题' : '只读' }}</span>
              <span v-if="expired(t.expiresAt)" class="chip bad">已过期</span>
            </div>
            <span class="tk-meta">
              {{ t.lastUsedAt ? `${relativeTime(t.lastUsedAt)}用过` : '还没用过' }} ·
              {{ t.expiresAt ? `${formatDate(t.expiresAt)} ${expired(t.expiresAt) ? '已过期' : '到期'}` : '不过期' }}
            </span>
            <button
              type="button"
              class="a-icon-btn danger"
              :aria-label="`撤销令牌 ${t.name}`"
              title="撤销"
              :disabled="busy !== null"
              @click="revokeToken(t)"
            >
              <AdminIcon name="trash" :size="16" />
            </button>
          </li>
        </ul>
      </section>

      <section class="sec zone" aria-labelledby="sec-disable">
        <header class="sec-head"><h3 id="sec-disable">{{ u.disabledAt ? '重新启用账号' : '停用账号' }}</h3></header>
        <div class="row">
          <p class="desc">
            {{
              u.disabledAt
                ? '启用后可以正常登录，访问令牌恢复可用；停用前登录过的设备需要重新登录。'
                : isSelf
                  ? '不能停用自己的账号。'
                  : '停用后不能登录，已登录的设备马上下线，访问令牌暂停使用。学习记录都会保留，随时可以重新启用。'
            }}
          </p>
          <button v-if="u.disabledAt" type="button" class="btn btn-sm" :disabled="busy !== null" @click="toggleDisabled">
            {{ busy === 'disable' ? '处理中…' : '重新启用' }}
          </button>
          <button v-else type="button" class="btn btn-sm danger" :disabled="isSelf || busy !== null" @click="toggleDisabled">
            {{ busy === 'disable' ? '处理中…' : '停用账号' }}
          </button>
        </div>
      </section>
    </div>
  </ElDrawer>
</template>

<style scoped>
:global(.user-drawer .el-drawer__header) {
  align-items: flex-start;
  margin-bottom: 0;
  padding: 22px 20px 16px 24px;
}

:global(.user-drawer .el-drawer__body) {
  padding: 0 24px 40px;
}

.head {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--c-bg-mute);
  font-size: 20px;
  font-weight: 700;
  color: var(--c-text-1);
}

.avatar.admin {
  background: var(--c-ink);
  color: var(--c-on-ink);
}

.head-text {
  min-width: 0;
}

.head-text h2,
.placeholder-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--c-text-1);
}

.head-text p {
  margin: 2px 0 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-3);
}

.me {
  margin-left: 8px;
  padding: 0 6px;
  border-radius: var(--r-xs);
  background: var(--c-brand-soft);
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  vertical-align: 3px;
  color: var(--c-brand);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--r-full);
  background: var(--c-default-soft);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--c-text-2);
}

.chip.ink {
  background: var(--c-ink);
  color: var(--c-on-ink);
}

.chip.ok {
  background: var(--c-success-soft);
  color: var(--c-success);
}

.chip.warn {
  background: var(--c-warning-soft);
  color: var(--c-warning);
}

.chip.bad {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.meta {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-3);
}

.sec {
  padding-top: 18px;
  border-top: 1px solid var(--c-divider);
}

.sec-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
  margin-bottom: 12px;
}

.sec-head h3 {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 700;
}

.sec-head .aside {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.quota-now {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}

.big {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--c-text-1);
}

.of {
  font-size: 13px;
  color: var(--c-text-3);
}

.bar {
  height: 6px;
  margin: 10px 0 14px;
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--c-bg-mute);
}

.bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--c-brand);
  transition: width var(--dur) var(--ease);
}

.bar.full i {
  background: var(--c-danger);
}

.quota-now + .quota-form {
  margin-top: 14px;
}

.quota-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.quota-input {
  width: 120px;
}

.hint {
  margin: 10px 0 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-3);
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-divider);
}

.stats.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.stats > div {
  padding: 10px 12px;
  background: var(--c-bg-elv);
}

.stats dt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  white-space: nowrap;
  color: var(--c-text-3);
}

.stats dd {
  margin: 4px 0 0;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--c-text-1);
}

.stats dd small {
  margin-left: 6px;
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--c-text-3);
}

.stats dd.unset {
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--c-text-3);
}

.sep {
  margin: 0 4px;
  color: var(--c-text-3);
}

.st {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.st.mastered {
  background: var(--st-mastered);
}

.st.fuzzy {
  background: var(--st-fuzzy);
}

.st.weak {
  background: var(--st-weak);
}

.none {
  margin: 0;
  font-size: 13px;
  color: var(--c-text-3);
}

.mini {
  width: 100%;
  margin-top: 12px;
  border-collapse: collapse;
  font-size: 13px;
}

.mini th {
  padding: 6px 8px;
  border-bottom: 1px solid var(--c-divider);
  font-size: 12px;
  font-weight: 600;
  text-align: right;
  color: var(--c-text-3);
}

.mini th:first-child,
.mini td:first-child {
  padding-left: 0;
  text-align: left;
}

.mini td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--c-divider);
  color: var(--c-text-2);
}

.mini td.n {
  text-align: right;
  color: var(--c-text-1);
}

.mini td.bad {
  color: var(--c-danger);
}

.sub {
  margin: 16px 0 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-text-3);
}

.calls,
.tokens {
  margin: 0;
  padding: 0;
  list-style: none;
}

.calls li {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) auto 64px;
  align-items: center;
  gap: 2px 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--c-divider);
  font-size: 13px;
}

.calls li:last-child {
  border-bottom: none;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--c-text-2);
}

.status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--st-mastered);
}

.status.aborted i {
  background: var(--st-fuzzy);
}

.status.error {
  color: var(--c-danger);
}

.status.error i {
  background: var(--st-weak);
}

.what {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-1);
}

.what em {
  margin-left: 6px;
  font-style: normal;
  font-size: 11.5px;
  color: var(--c-brand);
}

.model {
  margin-left: 8px;
  color: var(--c-text-3);
}

.cost {
  color: var(--c-text-2);
}

.calls time {
  font-size: 12px;
  text-align: right;
  color: var(--c-text-3);
}

.err {
  grid-column: 2 / -1;
  margin: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-danger);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 20px;
  padding: 10px 0;
}

.row + .row {
  border-top: 1px solid var(--c-divider);
}

.label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.label strong {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-3);
}

.tokens li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--c-divider);
}

.tokens li:last-child {
  border-bottom: none;
}

.tk-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  min-width: 0;
  font-size: 14px;
}

.prefix {
  color: var(--c-text-3);
}

.tk-meta {
  grid-column: 1;
  font-size: 12px;
  color: var(--c-text-3);
}

.tokens .a-icon-btn {
  grid-column: 2;
  grid-row: 1 / span 2;
}

.zone h3 {
  color: var(--c-danger);
}

.btn.danger {
  border-color: var(--c-danger);
  color: var(--c-danger);
}

.btn.danger:hover:not(:disabled) {
  border-color: var(--c-danger);
  background: var(--c-danger-soft);
}

.link-btn {
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}

@media (max-width: 520px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  /* 手机上每条调用两行：状态和时间一行，功能和耗时一行，出错信息单独一行 */
  .calls li {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .calls .status {
    grid-area: 1 / 1;
  }

  .calls time {
    grid-area: 1 / 2;
  }

  .what {
    grid-area: 2 / 1;
  }

  .cost {
    grid-area: 2 / 2;
  }

  .err {
    grid-column: 1 / -1;
  }

  .row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
