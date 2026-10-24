<script setup lang="ts">
import type { AdminAiSettings } from '#shared/types/admin'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'AI 设置' })

interface CheckResult {
  baseUrl: string
  model: string
  configured: boolean
  ok: boolean
  message: string
  models: string[]
}

interface Form {
  model: string
  dailyLimit: number
  extraHosts: string[]
  allowUserKey: boolean
  pricingOn: boolean
  pricing: { input: number; output: number; currency: 'CNY' | 'USD' }
}

const { data: settings, refresh } = await useFetch<{ ai: AdminAiSettings; contentSync: boolean }>('/api/admin/settings', {
  key: 'admin-settings',
})

const form = reactive<Form>({
  model: '',
  dailyLimit: 30,
  extraHosts: [],
  allowUserKey: true,
  pricingOn: false,
  pricing: { input: 0, output: 0, currency: 'CNY' },
})

const baseline = ref('')
function fill() {
  const ai = settings.value?.ai
  if (!ai) return
  Object.assign(form, {
    model: ai.model,
    dailyLimit: ai.dailyLimit,
    extraHosts: [...ai.extraHosts],
    allowUserKey: ai.allowUserKey,
    pricingOn: Boolean(ai.pricing),
    pricing: { ...(ai.pricing ?? { input: 0, output: 0, currency: 'CNY' }) },
  })
  baseline.value = JSON.stringify(form)
}
fill()
const dirty = computed(() => JSON.stringify(form) !== baseline.value)

onBeforeRouteLeave(() => {
  if (dirty.value && !confirm('AI 设置还没有保存，确定离开吗？')) return false
})

// ---------- 测试连接 ----------
const check = ref<CheckResult | null>(null)
const checking = ref(false)
const models = computed(() => {
  const list = new Set(check.value?.models ?? [])
  if (settings.value?.ai.defaults.model) list.add(settings.value.ai.defaults.model)
  if (form.model) list.add(form.model)
  return [...list].sort()
})

/** 用表单里的模型实际调用一次，保存前就能知道能不能用 */
async function test() {
  checking.value = true
  try {
    check.value = await $fetch<CheckResult>('/api/admin/ai/check', { method: 'POST', body: { model: form.model || undefined } })
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    checking.value = false
  }
}
onMounted(() => {
  if (settings.value?.ai.keyConfigured) test()
})

// ---------- 保存 ----------
const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch('/api/admin/settings/ai', {
      method: 'PUT',
      body: {
        model: form.model.trim(),
        dailyLimit: form.dailyLimit,
        extraHosts: form.extraHosts,
        allowUserKey: form.allowUserKey,
        pricing: form.pricingOn ? form.pricing : null,
      },
    })
    await refresh()
    fill()
    // 前台的 AI 入口读的是 /api/ai/status，一起刷新
    refreshNuxtData('ai-status')
    ElMessage.success('已保存，立即生效')
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

const defaults = computed(() => settings.value?.ai.defaults)
const isDefault = {
  model: () => form.model === defaults.value?.model,
  dailyLimit: () => form.dailyLimit === defaults.value?.dailyLimit,
  extraHosts: () => form.extraHosts.join(',') === defaults.value?.extraHosts.join(','),
}

const symbol = computed(() => (form.pricing.currency === 'CNY' ? '¥' : '$'))
/** 按一次面试大约 3000 输入 + 800 输出 token 估算 */
const perInterview = computed(() => ((3000 * form.pricing.input + 800 * form.pricing.output) / 1e6).toFixed(4))
</script>

<template>
  <div class="ai-page">
    <AdminPageHead eyebrow="系统" title="AI 设置">
      <template #desc>模型、次数和价格在这里改，保存后立即生效。接口地址和 API Key 只放在服务器的 <span class="a-code">.env</span> 里，不经过浏览器。</template>
    </AdminPageHead>

    <div v-if="settings" class="grid">
      <div class="col">
        <!-- 连接状态 -->
        <section class="a-card">
          <div class="a-card-head">
            <h2>连接</h2>
            <span class="aside">来自 .env，改了要重启服务</span>
          </div>
          <div class="a-card-body">
            <dl class="kv">
              <dt>接口地址</dt>
              <dd><span class="a-code">{{ settings.ai.baseUrl || '未设置' }}</span></dd>
              <dt>API Key</dt>
              <dd>
                <span class="key" :class="{ on: settings.ai.keyConfigured }">
                  <i aria-hidden="true" />{{ settings.ai.keyConfigured ? '已配置' : '未配置' }}
                </span>
              </dd>
            </dl>
            <div v-if="!settings.ai.keyConfigured" class="a-alert warn">
              <AdminIcon name="alert" :size="16" />
              <span>在 <span class="a-code">.env</span> 里填写 <span class="a-code">NUXT_AI_API_KEY</span> 后重启服务。没有站点 Key 时，用户仍可以用自己的 Key。</span>
            </div>
            <template v-else>
              <div v-if="checking" class="a-alert info"><AdminIcon name="sync" :size="16" />正在用 {{ form.model }} 测试…</div>
              <div v-else-if="check" class="a-alert" :class="check.ok ? 'ok' : 'bad'">
                <AdminIcon :name="check.ok ? 'check' : 'alert'" :size="16" />{{ check.message }}
              </div>
              <button type="button" class="btn btn-sm test-btn" :disabled="checking" @click="test">
                <AdminIcon name="pulse" :size="15" />测试当前填写的模型
              </button>
            </template>
          </div>
        </section>

        <!-- 用户自带 Key -->
        <section class="a-card">
          <div class="a-card-head"><h2>用户自带 Key</h2></div>
          <div class="a-card-body">
            <button type="button" role="switch" class="switch" :aria-checked="form.allowUserKey" @click="form.allowUserKey = !form.allowUserKey">
              <span class="switch-track" />允许用户在页面上填写自己的 API Key
            </button>
            <p class="tip">
              {{ form.allowUserKey
                ? '用户的 Key 只保存在用户自己的浏览器里，调用时经服务器转发，不占站点的次数。'
                : '关闭后前台不再显示"填写自己的 Key"，所有调用都用站点的 Key 和次数。' }}
            </p>
            <div v-if="form.allowUserKey" class="field">
              <label class="label" for="hosts">额外允许的服务商域名</label>
              <ElSelect
                id="hosts"
                v-model="form.extraHosts"
                multiple
                filterable
                allow-create
                default-first-option
                :reserve-keyword="false"
                placeholder="输入域名后回车，例如 api.example.com"
              />
              <p class="tip">
                Kimi、DeepSeek、通义千问等常见服务商已经内置。为了防止借服务器访问内网，只允许 https 和这里列出的域名。
                <template v-if="!isDefault.extraHosts()"> · 已在后台修改</template>
              </p>
            </div>
          </div>
        </section>
      </div>

      <div class="col">
        <!-- 模型和次数 -->
        <section class="a-card">
          <div class="a-card-head"><h2>模型与次数</h2></div>
          <div class="a-card-body">
            <div class="field">
              <label class="label" for="model">站点 Key 使用的模型</label>
              <ElSelect id="model" v-model="form.model" filterable allow-create default-first-option placeholder="选择或输入模型名">
                <ElOption v-for="m in models" :key="m" :label="m" :value="m" />
              </ElSelect>
              <p class="tip">
                .env 默认 <span class="a-code">{{ defaults?.model || '未设置' }}</span>
                <button v-if="!isDefault.model()" type="button" class="link" @click="form.model = defaults?.model ?? ''">恢复默认</button>
                <template v-if="check?.models.length"> · 服务商提供 {{ check.models.length }} 个模型</template>
              </p>
            </div>
            <div class="field">
              <label class="label" for="limit">每人 24 小时次数</label>
              <ElInputNumber id="limit" v-model="form.dailyLimit" :min="0" :max="10000" :step="5" controls-position="right" />
              <p class="tip">
                只限制用站点 Key 的调用，填 0 表示只能用自己的 Key。.env 默认 {{ defaults?.dailyLimit }} 次
                <button v-if="!isDefault.dailyLimit()" type="button" class="link" @click="form.dailyLimit = defaults?.dailyLimit ?? 30">恢复默认</button>
              </p>
            </div>
          </div>
        </section>

        <!-- 价格 -->
        <section class="a-card">
          <div class="a-card-head">
            <h2>价格</h2>
            <span class="aside">用于在概览页估算花费</span>
          </div>
          <div class="a-card-body">
            <button type="button" role="switch" class="switch" :aria-checked="form.pricingOn" @click="form.pricingOn = !form.pricingOn">
              <span class="switch-track" />按 token 估算站点 Key 的花费
            </button>
            <template v-if="form.pricingOn">
              <div class="price-row">
                <div class="a-seg" role="group" aria-label="币种">
                  <button type="button" :aria-pressed="form.pricing.currency === 'CNY'" @click="form.pricing.currency = 'CNY'">人民币</button>
                  <button type="button" :aria-pressed="form.pricing.currency === 'USD'" @click="form.pricing.currency = 'USD'">美元</button>
                </div>
              </div>
              <div class="price-grid">
                <div class="field">
                  <label class="label" for="p-in">输入 · 每百万 token</label>
                  <ElInputNumber id="p-in" v-model="form.pricing.input" :min="0" :max="10000" :precision="2" :step="0.5" controls-position="right" />
                </div>
                <div class="field">
                  <label class="label" for="p-out">输出 · 每百万 token</label>
                  <ElInputNumber id="p-out" v-model="form.pricing.output" :min="0" :max="10000" :precision="2" :step="0.5" controls-position="right" />
                </div>
              </div>
              <p class="tip">价格以服务商官网为准。按一次面试约 3000 输入 + 800 输出 token 算，每次约 {{ symbol }}{{ perInterview }}。</p>
            </template>
          </div>
        </section>
      </div>
    </div>

    <!-- 保存条 -->
    <Transition name="savebar">
      <div v-if="dirty" class="savebar" role="region" aria-label="保存设置">
        <span><i aria-hidden="true" />有未保存的修改</span>
        <button type="button" class="btn btn-sm btn-ghost" :disabled="saving" @click="fill">撤销</button>
        <button type="button" class="btn btn-sm btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ai-page {
  padding-bottom: 40px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.kv {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px 12px;
  margin: 0 0 14px;
  font-size: 14px;
}

.kv dt {
  color: var(--c-text-3);
}

.kv dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--c-warning);
}

.key i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--st-fuzzy);
}

.key.on {
  color: var(--c-success);
}

.key.on i {
  background: var(--st-mastered);
}

.test-btn {
  margin-top: 12px;
}

.field + .field {
  margin-top: 18px;
}

.switch + .field,
.tip + .field {
  margin-top: 18px;
}

.label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 600;
}

.field :deep(.el-select),
.field :deep(.el-input-number) {
  width: 100%;
}

.tip {
  margin: 6px 0 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.link {
  margin-left: 6px;
  padding: 0;
  border: none;
  background: none;
  font-size: inherit;
  font-weight: 600;
  color: var(--c-brand);
  cursor: pointer;
}

.price-row {
  margin: 16px 0 12px;
}

.price-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.price-grid .field + .field {
  margin-top: 0;
}

/* ---------- 保存条 ---------- */
.savebar {
  position: fixed;
  bottom: 24px;
  left: calc(50% + 116px);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 16px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-lg);
  font-size: 13.5px;
  transform: translateX(-50%);
}

.savebar span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-right: 8px;
  color: var(--c-warning);
  white-space: nowrap;
}

.savebar span i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--st-fuzzy);
}

.savebar-enter-active,
.savebar-leave-active {
  transition:
    opacity var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}

.savebar-enter-from,
.savebar-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}

@media (max-width: 1000px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 860px) {
  .savebar {
    left: 50%;
  }
}
</style>
