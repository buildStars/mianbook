<script setup lang="ts">
const props = defineProps<{ mode: 'login' | 'register' }>()

const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const { all } = useOutline()

const form = reactive({ email: '', name: '', password: '', code: '' })
const loading = ref(false)
const errorMsg = ref('')

// 注册是否需要邮箱验证码，由服务端决定（配置了发信并且后台开着）
const { data: options } = useFetch<{ emailCode: boolean }>('/api/auth/options', {
  key: 'auth-options',
  default: () => ({ emailCode: false }),
})
const needCode = computed(() => props.mode === 'register' && options.value.emailCode)

const sending = ref(false)
const countdown = ref(0)
const codeHint = ref('')
let timer: ReturnType<typeof setInterval> | undefined

function startCountdown(seconds: number) {
  countdown.value = Math.ceil(seconds)
  clearInterval(timer)
  timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) clearInterval(timer)
  }, 1000)
}
onBeforeUnmount(() => clearInterval(timer))

async function sendCode() {
  errorMsg.value = ''
  const email = form.email.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorMsg.value = '请先填写正确的邮箱'
    return
  }
  sending.value = true
  try {
    const res = await $fetch<{ cooldown: number; expiresInMinutes: number }>('/api/auth/email-code', {
      method: 'POST',
      body: { email, purpose: 'register' },
    })
    codeHint.value = `验证码已发送到 ${email}，${res.expiresInMinutes} 分钟内有效。没收到的话看看垃圾邮件`
    startCountdown(res.cooldown)
  } catch (error: any) {
    errorMsg.value = error?.data?.message ?? '发送失败，请稍后再试'
    // 发送太频繁时，按服务端给的等待时间倒计时
    const retry = Number(error?.data?.data?.retryAfter)
    if (retry > 0 && retry <= 120) startCountdown(retry)
  } finally {
    sending.value = false
  }
}

const redirect = computed(() => {
  const target = String(route.query.redirect ?? '/')
  // 只允许跳转到站内路径
  return target.startsWith('/') && !target.startsWith('//') ? target : '/'
})

async function submit() {
  errorMsg.value = ''
  loading.value = true
  try {
    await $fetch(`/api/auth/${props.mode}`, { method: 'POST', body: form })
    await refreshSession()
    await navigateTo(redirect.value)
  } catch (error: any) {
    errorMsg.value = error?.data?.message ?? '出错了，请稍后再试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth container">
    <div class="auth-card">
      <aside class="side" aria-hidden="true">
        <span class="seal side-seal">面</span>
        <p class="side-title serif">把面试题，<br>讲成自己的话。</p>
        <ul class="perks">
          <li><i>✓</i>{{ all.length || '近百' }} 道高频题：一句话回答、详解、追问、易错点</li>
          <li><i>✓</i>AI 模拟面试官打分、挑漏洞、再追问</li>
          <li><i>✓</i>掌握程度和笔记多端同步</li>
        </ul>
        <div class="side-card">
          <span class="side-card-label">AI 点评</span>
          <span class="side-card-score serif">8<small>/10</small></span>
          <p>说清了宏任务和微任务的顺序，补充一下渲染时机就更完整了。</p>
        </div>
      </aside>

      <main class="main">
        <h1 class="serif">{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</h1>
        <p class="sub">
          {{ mode === 'login' ? '登录后学习记录会同步到账号，还可以使用 AI 模拟面试。' : '注册后学习记录保存在服务器上，手机和电脑自动同步。' }}
        </p>
        <ElForm label-position="top" size="large" @submit.prevent="submit">
          <ElFormItem label="邮箱">
            <ElInput v-model="form.email" type="email" autocomplete="email" placeholder="you@example.com" />
          </ElFormItem>
          <ElFormItem v-if="needCode" label="邮箱验证码">
            <div class="code-row">
              <ElInput v-model="form.code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位数字" />
              <button type="button" class="btn code-btn" :disabled="sending || countdown > 0" @click="sendCode">
                {{ countdown > 0 ? `${countdown} 秒后重发` : sending ? '发送中…' : '获取验证码' }}
              </button>
            </div>
            <p v-if="codeHint" class="code-hint">{{ codeHint }}</p>
          </ElFormItem>
          <ElFormItem v-if="mode === 'register'" label="昵称">
            <ElInput v-model="form.name" maxlength="32" autocomplete="nickname" placeholder="怎么称呼你" />
          </ElFormItem>
          <ElFormItem label="密码">
            <ElInput
              v-model="form.password"
              type="password"
              show-password
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              :placeholder="mode === 'register' ? '至少 8 位' : '输入密码'"
            />
          </ElFormItem>
          <p v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</p>
          <button type="submit" class="btn btn-primary btn-lg submit" :disabled="loading">
            {{ loading ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
          </button>
        </ElForm>
        <p class="switch">
          <template v-if="mode === 'login'">
            还没有账号？<NuxtLink :to="{ path: '/register', query: route.query }">免费注册</NuxtLink>
          </template>
          <template v-else>
            已有账号？<NuxtLink :to="{ path: '/login', query: route.query }">直接登录</NuxtLink>
          </template>
        </p>
      </main>
    </div>
  </div>
</template>

<style scoped>
.auth {
  display: flex;
  justify-content: center;
  padding-top: 56px;
}

.auth-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  width: 100%;
  max-width: 940px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-xl);
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

/* 左侧品牌面板 */
.side {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 44px 40px;
  overflow: hidden;
  background: #121318;
  color: #ecebe7;
  isolation: isolate;
}

.side::before {
  content: '';
  position: absolute;
  right: -30%;
  bottom: -30%;
  z-index: -1;
  width: 90%;
  height: 80%;
  background:
    radial-gradient(closest-side, rgba(59, 91, 255, 0.4), transparent 70%),
    radial-gradient(closest-side at 70% 40%, rgba(139, 92, 246, 0.35), transparent 70%);
  filter: blur(10px);
}

.side-seal {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  font-size: 24px;
}

.side-title {
  margin: 28px 0 0;
  font-size: 30px;
  font-weight: 800;
  line-height: 1.35;
}

.perks {
  display: grid;
  gap: 12px;
  margin: 28px 0 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
  color: rgba(236, 235, 231, 0.75);
}

.perks li {
  display: flex;
  gap: 10px;
}

.perks i {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border-radius: 50%;
  background: rgba(61, 207, 142, 0.18);
  color: #3dcf8e;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 18px;
  text-align: center;
}

.side-card {
  margin-top: auto;
  padding: 16px 18px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--r-lg);
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(6px);
}

.side-card-label {
  font-size: 12px;
  font-weight: 700;
  color: #b6a9ff;
}

.side-card-score {
  float: right;
  font-size: 24px;
  font-weight: 800;
  line-height: 1;
  color: #3dcf8e;
}

.side-card-score small {
  font-size: 13px;
  color: rgba(236, 235, 231, 0.5);
}

.side-card p {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(236, 235, 231, 0.75);
}

/* 右侧表单 */
.main {
  padding: 48px 44px 40px;
}

h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
}

.sub {
  margin: 8px 0 28px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.main :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--c-text-1);
}

.submit {
  width: 100%;
  margin-top: 4px;
}

.code-row {
  display: flex;
  gap: 10px;
  width: 100%;
}

.code-row :deep(.el-input) {
  flex: 1;
}

.code-btn {
  flex: none;
  min-width: 124px;
}

.code-hint {
  width: 100%;
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.error {
  margin: -6px 0 14px;
  font-size: 13px;
  color: var(--c-danger);
}

.switch {
  margin: 22px 0 0;
  font-size: 14px;
  text-align: center;
  color: var(--c-text-2);
}

.switch a {
  font-weight: 600;
}

@media (max-width: 820px) {
  .auth {
    padding-top: 32px;
  }

  .auth-card {
    grid-template-columns: minmax(0, 1fr);
    max-width: 460px;
  }

  .side {
    display: none;
  }

  .main {
    padding: 36px 24px 32px;
  }
}
</style>
