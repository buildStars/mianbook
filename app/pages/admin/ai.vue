<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'AI 设置 | 全栈面试手册' })

interface CheckResult {
  baseUrl: string
  model: string
  dailyLimit: number
  configured: boolean
  ok: boolean
  message: string
  models: string[]
}

const result = ref<CheckResult | null>(null)
const checking = ref(false)

async function check() {
  checking.value = true
  try {
    result.value = await $fetch<CheckResult>('/api/admin/ai/check', { method: 'POST' })
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    checking.value = false
  }
}

onMounted(check)
</script>

<template>
  <div>
    <h1>AI 设置</h1>

    <div class="card panel">
      <h2>当前配置</h2>
      <dl v-if="result">
        <dt>接口地址</dt><dd><code>{{ result.baseUrl }}</code></dd>
        <dt>模型</dt><dd><code>{{ result.model }}</code></dd>
        <dt>API Key</dt><dd>{{ result.configured ? '已配置' : '未配置' }}</dd>
        <dt>每人 24 小时上限</dt><dd>{{ result.dailyLimit }} 次</dd>
      </dl>
      <div class="status" :class="{ ok: result?.ok, bad: result && !result.ok }">
        <span v-if="checking">检查中……</span>
        <span v-else-if="result">{{ result.ok ? '✓' : '✗' }} {{ result.message }}</span>
      </div>
      <ElButton :loading="checking" @click="check">重新检查</ElButton>
    </div>

    <div v-if="result?.models.length" class="card panel">
      <h2>可用模型（{{ result.models.length }}）</h2>
      <p class="muted">把想用的模型名填到 <code>NUXT_AI_MODEL</code>，重启服务后生效。</p>
      <div class="models">
        <ElTag v-for="m in result.models" :key="m" :type="m === result.model ? 'success' : 'info'" effect="plain">{{ m }}</ElTag>
      </div>
    </div>

    <div class="card panel">
      <h2>怎么配置</h2>
      <ol>
        <li>在 Kimi 开放平台（platform.moonshot.cn）的控制台创建 API Key。</li>
        <li>打开项目根目录的 <code>.env</code>，把 Key 填在 <code>NUXT_AI_API_KEY=</code> 后面。</li>
        <li>按需修改 <code>NUXT_AI_MODEL</code>（可用模型见上方列表）和 <code>NUXT_AI_DAILY_LIMIT</code>。</li>
        <li>重启 <code>npm run dev</code>，回到这里点"重新检查"。</li>
      </ol>
      <p class="muted">接口是 OpenAI 兼容格式，换成 DeepSeek、通义千问等服务商时，只需同时修改 <code>NUXT_AI_BASE_URL</code> 和 <code>NUXT_AI_MODEL</code>。API Key 只保存在服务端，不会发送到浏览器。</p>
    </div>
  </div>
</template>

<style scoped>
h1 {
  margin: 0 0 16px;
  font-size: 22px;
}

.panel {
  margin-bottom: 16px;
  padding: 18px 20px;
  background: var(--c-bg-elv);
  font-size: 14px;
}

.panel h2 {
  margin: 0 0 12px;
  font-size: 16px;
}

dl {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px 12px;
  margin: 0 0 16px;
}

dt {
  color: var(--c-text-2);
}

dd {
  margin: 0;
}

code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--c-default-soft);
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.status {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--c-default-soft);
}

.status.ok {
  background: var(--c-success-soft);
  color: var(--c-success);
}

.status.bad {
  background: var(--c-warning-soft);
  color: var(--c-warning);
}

.models {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

ol {
  margin: 0 0 12px;
  padding-left: 1.2em;
  line-height: 2;
}
</style>
