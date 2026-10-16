<script setup lang="ts">
useHead({ title: '重置密码 | 全栈面试手册' })

const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const { data: options } = useFetch<{ emailCode: boolean; passwordReset: boolean }>('/api/auth/options', {
  key: 'auth-options',
  default: () => ({ emailCode: false, passwordReset: false }),
})

const form = reactive({ email: typeof route.query.email === 'string' ? route.query.email : '', code: '', password: '', confirm: '' })
const sending = ref(false)
const sent = ref(false)
const countdown = ref(0)
const hint = ref('')
const errorMsg = ref('')
const loading = ref(false)
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
    const res = await $fetch<{ cooldown: number; expiresInMinutes: number }>('/api/auth/password-reset/code', { method: 'POST', body: { email } })
    sent.value = true
    // 不管邮箱有没有注册，提示都一样
    hint.value = `如果 ${email} 注册过，验证码已经发过去了，${res.expiresInMinutes} 分钟内有效。没收到的话看看垃圾邮件`
    startCountdown(res.cooldown)
  } catch (error: any) {
    errorMsg.value = error?.data?.message ?? '发送失败，请稍后再试'
    const retry = Number(error?.data?.data?.retryAfter)
    if (retry > 0 && retry <= 120) startCountdown(retry)
  } finally {
    sending.value = false
  }
}

async function submit() {
  errorMsg.value = ''
  if (form.password !== form.confirm) {
    errorMsg.value = '两次输入的密码不一样'
    return
  }
  loading.value = true
  try {
    await $fetch('/api/auth/password-reset', { method: 'POST', body: { email: form.email.trim(), code: form.code.trim(), password: form.password } })
    await refreshSession()
    ElMessage.success('密码已重置，其他设备上的登录已退出')
    await navigateTo('/')
  } catch (error: any) {
    errorMsg.value = error?.data?.message ?? '重置失败，请稍后再试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page container">
    <div class="card box">
      <h1 class="serif">重置密码</h1>
      <p class="sub">用注册时的邮箱接收验证码，设置新密码。重置后其他设备上的登录会退出。</p>

      <p v-if="!options.passwordReset" class="notice">站点还没有配置发信邮箱，暂时不能自助重置密码，请联系管理员。</p>

      <ElForm v-else label-position="top" size="large" @submit.prevent="submit">
        <ElFormItem label="邮箱">
          <ElInput v-model="form.email" type="email" autocomplete="email" placeholder="you@example.com" />
        </ElFormItem>
        <ElFormItem label="邮箱验证码">
          <div class="code-row">
            <ElInput v-model="form.code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位数字" />
            <button type="button" class="btn code-btn" :disabled="sending || countdown > 0" @click="sendCode">
              {{ countdown > 0 ? `${countdown} 秒后重发` : sending ? '发送中…' : sent ? '重新发送' : '获取验证码' }}
            </button>
          </div>
          <p v-if="hint" class="code-hint">{{ hint }}</p>
        </ElFormItem>
        <ElFormItem label="新密码">
          <ElInput v-model="form.password" type="password" show-password autocomplete="new-password" placeholder="至少 8 位" />
        </ElFormItem>
        <ElFormItem label="再输一次">
          <ElInput v-model="form.confirm" type="password" show-password autocomplete="new-password" placeholder="和上面一样" />
        </ElFormItem>
        <p v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</p>
        <button type="submit" class="btn btn-primary btn-lg submit" :disabled="loading || !form.code || form.password.length < 8">
          {{ loading ? '请稍候…' : '重置并登录' }}
        </button>
      </ElForm>

      <p class="back">想起来了？<NuxtLink to="/login">返回登录</NuxtLink></p>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  justify-content: center;
  padding-top: 56px;
  padding-bottom: 80px;
}

.box {
  width: 100%;
  max-width: 460px;
  padding: 40px 36px 32px;
}

h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
}

.sub {
  margin: 8px 0 24px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.box :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--c-text-1);
}

.notice {
  margin: 0 0 8px;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--c-default-soft);
  font-size: 14px;
  color: var(--c-text-2);
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

.submit {
  width: 100%;
  margin-top: 4px;
}

.back {
  margin: 22px 0 0;
  font-size: 14px;
  text-align: center;
  color: var(--c-text-2);
}

@media (max-width: 640px) {
  .page {
    padding-top: 28px;
  }

  .box {
    padding: 28px 20px 24px;
  }
}
</style>
