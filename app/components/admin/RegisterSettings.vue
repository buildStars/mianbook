<script setup lang="ts">
/** 用户页顶部的注册设置：发信状态、注册验证码开关、测试邮件 */
interface AuthStatus {
  emailCode: boolean
  requireEmailCode: boolean | null
  mail: { configured: boolean; mode: 'smtp' | 'outbox' | 'none'; host: string; from: string }
}

const { data: settings, refresh } = await useFetch<{ auth: AuthStatus }>('/api/admin/settings', { key: 'admin-settings' })
const auth = computed(() => settings.value?.auth)
const saving = ref(false)
const testing = ref(false)

async function toggle() {
  if (!auth.value?.mail.configured || saving.value) return
  saving.value = true
  try {
    const next = !auth.value.emailCode
    await $fetch('/api/admin/settings/auth', { method: 'PUT', body: { requireEmailCode: next } })
    await refresh()
    ElMessage.success(next ? '已开启：注册需要邮箱验证码' : '已关闭：注册不再需要验证码')
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function sendTest() {
  testing.value = true
  try {
    const res = await $fetch<{ to: string }>('/api/admin/mail/test', { method: 'POST' })
    ElMessage.success(`测试邮件已发到 ${res.to}，请查收`)
  } catch (error) {
    ElMessage.error({ message: errorMessage(error), duration: 8000 })
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <section v-if="auth" class="a-card reg">
    <div class="a-card-head">
      <h2>注册设置</h2>
      <span class="aside">防止用随便编的邮箱批量注册</span>
    </div>
    <div class="a-card-body body">
      <div class="row">
        <div class="label">
          <strong>发信邮箱</strong>
          <span v-if="auth.mail.mode === 'smtp'" class="mail ok"><i aria-hidden="true" />已配置 · {{ auth.mail.host }} · {{ auth.mail.from }}</span>
          <span v-else-if="auth.mail.mode === 'outbox'" class="mail info"><i aria-hidden="true" />本地发件箱模式：邮件写成文件，不会真正发出</span>
          <span v-else class="mail warn"><i aria-hidden="true" />未配置：在服务器的 .env 里填写 NUXT_MAIL_HOST、NUXT_MAIL_USER、NUXT_MAIL_PASS 后重启应用</span>
        </div>
        <button type="button" class="btn btn-sm" :disabled="!auth.mail.configured || testing" @click="sendTest">
          <AdminIcon name="sync" :size="15" />{{ testing ? '发送中…' : '发测试邮件给我' }}
        </button>
      </div>
      <div class="row">
        <div class="label">
          <strong>注册需要邮箱验证码</strong>
          <span class="desc">
            {{ auth.mail.configured
              ? '开启后，注册时要先收到邮件里的 6 位验证码。发信出问题时可以临时关掉'
              : '需要先配置发信邮箱' }}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          class="switch"
          :aria-checked="auth.emailCode"
          :disabled="!auth.mail.configured || saving"
          @click="toggle"
        >
          <span class="switch-track" />{{ auth.emailCode ? '已开启' : '已关闭' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.reg {
  margin-bottom: 16px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 20px;
  padding: 12px 0;
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
  font-size: 14px;
}

.desc {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.mail {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  overflow-wrap: anywhere;
}

.mail i {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.mail.ok {
  color: var(--c-success);
}

.mail.ok i {
  background: var(--st-mastered);
}

.mail.info {
  color: var(--c-text-2);
}

.mail.info i {
  background: var(--c-brand);
}

.mail.warn {
  color: var(--c-warning);
}

.mail.warn i {
  background: var(--st-fuzzy);
}

.switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
