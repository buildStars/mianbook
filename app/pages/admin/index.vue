<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '后台概览 | 全栈面试手册' })

const { data: stats } = await useFetch('/api/admin/stats')
const { data: ai } = useFetch('/api/ai/status', { key: 'ai-status' })

const cards = computed(() => [
  { label: '题目', value: stats.value?.questions ?? 0, sub: `已发布 ${stats.value?.published ?? 0}` },
  { label: '用户', value: stats.value?.users ?? 0 },
  { label: '学习记录', value: stats.value?.studyRecords ?? 0 },
  { label: 'AI 面试', value: stats.value?.interviews ?? 0, sub: `24 小时调用 ${stats.value?.aiCalls24h ?? 0} 次` },
])
</script>

<template>
  <div>
    <div class="page-head">
      <h1>概览</h1>
      <ElButton type="primary" @click="navigateTo('/admin/questions/new')">新建题目</ElButton>
    </div>

    <div class="cards">
      <div v-for="c in cards" :key="c.label" class="stat card">
        <span class="label">{{ c.label }}</span>
        <strong>{{ c.value }}</strong>
        <span v-if="c.sub" class="sub">{{ c.sub }}</span>
      </div>
    </div>

    <div class="card panel">
      <h2>AI 模拟面试官</h2>
      <p v-if="ai?.enabled" class="ok">已开启，当前模型 {{ ai.model }}，每个用户 24 小时内最多 {{ ai.dailyLimit }} 次。</p>
      <p v-else class="warn">还没有开启：在 <code>.env</code> 中填写 <code>NUXT_AI_API_KEY</code> 后重启服务。</p>
      <NuxtLink to="/admin/ai">检查 AI 配置 →</NuxtLink>
    </div>

    <div class="card panel">
      <h2>常用操作</h2>
      <ul>
        <li><NuxtLink to="/admin/questions">管理题目</NuxtLink>：搜索、编辑、发布或下线题目</li>
        <li><NuxtLink to="/admin/structure">管理分类</NuxtLink>：调整部分和分类的名称、顺序</li>
        <li>命令行 <code>npm run db:export</code> 可以把题库导出成 Markdown，方便备份和用 Git 管理</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

h1 {
  margin: 0;
  font-size: 22px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 20px;
  background: var(--c-bg-elv);
}

.label {
  font-size: 13px;
  color: var(--c-text-2);
}

.stat strong {
  font-size: 30px;
  line-height: 1.2;
}

.sub {
  font-size: 12px;
  color: var(--c-text-3);
}

.panel {
  margin-top: 16px;
  padding: 18px 20px;
  background: var(--c-bg-elv);
  font-size: 14px;
}

.panel h2 {
  margin: 0 0 8px;
  font-size: 16px;
}

.panel ul {
  margin: 0;
  padding-left: 1.2em;
  line-height: 2;
}

.ok {
  color: var(--c-success);
}

.warn {
  color: var(--c-warning);
}

code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--c-default-soft);
  font-family: var(--font-mono);
}
</style>
