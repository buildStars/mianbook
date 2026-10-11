<script setup lang="ts">
const props = defineProps<{ extraHosts: string[] }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const { config, hasKey, save, clear, headersFor } = useAiKey()

const CUSTOM = 'custom'
const form = reactive({
  providerId: config.value?.providerId ?? AI_PROVIDERS[0]!.id,
  baseUrl: config.value?.baseUrl ?? AI_PROVIDERS[0]!.baseUrl,
  model: config.value?.model ?? '',
  apiKey: config.value?.apiKey ?? '',
})
const showKey = ref(false)
const checking = ref(false)
const result = ref<{ ok: boolean; message: string } | null>(null)
const models = ref<string[]>([])

const isCustom = computed(() => form.providerId === CUSTOM)
const complete = computed(() => Boolean(form.baseUrl.trim() && form.model.trim() && form.apiKey.trim()))

watch(
  () => form.providerId,
  (id) => {
    const preset = AI_PROVIDERS.find((p) => p.id === id)
    if (preset) form.baseUrl = preset.baseUrl
    else if (!props.extraHosts.some((h) => form.baseUrl.includes(h))) form.baseUrl = `https://${props.extraHosts[0] ?? ''}/v1`
    models.value = []
    result.value = null
  },
)

const current = () => ({ ...form, baseUrl: form.baseUrl.trim(), model: form.model.trim(), apiKey: form.apiKey.trim() })

async function check() {
  if (!complete.value || checking.value) return
  checking.value = true
  result.value = null
  try {
    const res = await $fetch<{ ok: boolean; message: string; models: string[] }>('/api/ai/check', {
      method: 'POST',
      headers: headersFor(current()),
    })
    result.value = { ok: res.ok, message: res.message }
    models.value = res.models
  } catch (error: any) {
    result.value = { ok: false, message: error?.data?.message ?? '检查失败，请稍后再试' }
  } finally {
    checking.value = false
  }
}

function onSave() {
  if (!complete.value) return
  save(current())
  emit('saved')
}

function onClear() {
  clear()
  form.apiKey = ''
  form.model = ''
  result.value = null
  emit('saved')
}
</script>

<template>
  <form class="ai-settings" @submit.prevent="onSave">
    <div class="settings-head">
      <p class="settings-title">使用自己的 API Key</p>
      <button type="button" class="close" aria-label="关闭 AI 设置" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
    <p class="settings-tip">
      Key 只保存在当前浏览器里，不会存到服务器的数据库；面试时随请求发给服务器转交给模型，用完即弃。用自己的 Key 不受每日次数限制，费用由你的账户承担。
    </p>

    <div class="grid">
      <label class="field">
        <span>服务商</span>
        <select v-model="form.providerId">
          <option v-for="p in AI_PROVIDERS" :key="p.id" :value="p.id">{{ p.name }}</option>
          <option v-if="extraHosts.length" :value="CUSTOM">其他（管理员允许的地址）</option>
        </select>
      </label>
      <label class="field">
        <span>Base URL</span>
        <input v-model="form.baseUrl" type="url" :readonly="!isCustom" spellcheck="false" autocomplete="off" />
      </label>
      <label class="field">
        <span>模型</span>
        <input
          v-model="form.model"
          list="ai-model-options"
          spellcheck="false"
          autocomplete="off"
          placeholder="模型名，测试连接后可从列表选"
        />
        <datalist id="ai-model-options">
          <option v-for="m in models" :key="m" :value="m" />
        </datalist>
      </label>
      <label class="field">
        <span>API Key</span>
        <span class="key-input">
          <input
            v-model="form.apiKey"
            :type="showKey ? 'text' : 'password'"
            spellcheck="false"
            autocomplete="off"
            placeholder="sk-..."
          />
          <button type="button" class="toggle" :aria-pressed="showKey" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
        </span>
      </label>
    </div>

    <p v-if="result" class="result" :class="{ ok: result.ok }" role="status">{{ result.message }}</p>

    <div class="settings-actions">
      <button v-if="hasKey" type="button" class="btn btn-sm btn-ghost danger" @click="onClear">清除我的 Key</button>
      <span class="spacer" />
      <button type="button" class="btn btn-sm" :disabled="!complete || checking" @click="check">
        {{ checking ? '检查中…' : '测试连接' }}
      </button>
      <button type="submit" class="btn btn-sm btn-primary" :disabled="!complete">保存</button>
    </div>
  </form>
</template>

<style scoped>
.ai-settings {
  margin-bottom: 20px;
  padding: 18px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
}

.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settings-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.close {
  display: inline-flex;
  padding: 6px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  color: var(--c-text-2);
  cursor: pointer;
}

.close:hover {
  background: var(--c-bg-mute);
  color: var(--c-text-1);
}

.settings-tip {
  margin: 6px 0 16px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text-2);
}

.field input,
.field select {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg);
  color: var(--c-text-1);
  font: inherit;
  font-weight: 400;
  font-size: 14px;
}

.field input[readonly] {
  background: var(--c-bg-soft);
  color: var(--c-text-2);
}

.field input:focus-visible,
.field select:focus-visible {
  outline: 2px solid var(--c-brand);
  outline-offset: -1px;
  border-color: transparent;
}

.key-input {
  position: relative;
  display: block;
}

.key-input input {
  padding-right: 56px;
  font-family: var(--font-mono);
  font-size: 13px;
}

.toggle {
  position: absolute;
  top: 50%;
  right: 6px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  font-size: 12px;
  color: var(--c-brand);
  cursor: pointer;
  transform: translateY(-50%);
}

.result {
  margin: 14px 0 0;
  padding: 8px 12px;
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--st-weak) 10%, transparent);
  font-size: 13px;
  color: var(--st-weak-text);
}

.result.ok {
  background: color-mix(in srgb, var(--st-mastered) 12%, transparent);
  color: var(--st-mastered-text);
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.spacer {
  flex: 1;
}

.danger {
  color: var(--st-weak-text);
}

@media (max-width: 640px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
