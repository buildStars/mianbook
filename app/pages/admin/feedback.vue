<script setup lang="ts">
import type { AdminFeedbackRow } from '#shared/types/admin'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '反馈' })

const TABS: { value: FeedbackStatus | ''; label: string }[] = [
  { value: 'open', label: '待处理' },
  { value: 'resolved', label: '已处理' },
  { value: 'ignored', label: '已忽略' },
  { value: '', label: '全部' },
]
const status = ref<FeedbackStatus | ''>('open')

const { data, pending, refresh } = await useFetch<AdminFeedbackRow[]>('/api/admin/feedback', {
  key: 'admin-feedback',
  query: { status },
  default: () => [],
})

const busyId = ref<number | null>(null)
async function mark(row: AdminFeedbackRow, next: FeedbackStatus) {
  busyId.value = row.id
  try {
    await $fetch(`/api/admin/feedback/${row.id}`, { method: 'PUT', body: { status: next } })
    ElMessage.success(next === 'open' ? '已重新打开' : next === 'resolved' ? '已标记为处理完' : '已忽略')
    await refresh()
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    busyId.value = null
  }
}

const now = Date.now()
</script>

<template>
  <div>
    <AdminPageHead eyebrow="内容" title="反馈">
      <template #desc>读者在题目页提交的纠错和反馈。改完题目后标记为"已处理"；不用改的点"忽略"。</template>
    </AdminPageHead>

    <div class="a-card">
      <div class="filters">
        <div class="a-seg" role="group" aria-label="按状态筛选">
          <button v-for="t in TABS" :key="t.label" type="button" :aria-pressed="status === t.value" @click="status = t.value">
            {{ t.label }}
          </button>
        </div>
        <span class="total">共 <strong class="a-num">{{ data.length }}</strong> 条</span>
      </div>

      <ul v-if="data.length" v-loading="pending" class="items">
        <li v-for="row in data" :key="row.id" class="item">
          <div class="item-head">
            <span class="kind" :class="row.kind">{{ FEEDBACK_KIND_LABELS[row.kind] }}</span>
            <NuxtLink :to="`/admin/questions/${row.question.id}`" class="q-title"><RichTitle :title="row.question.title" /></NuxtLink>
            <span class="q-cat">{{ row.question.category }}<template v-if="!row.question.published"> · 草稿</template></span>
          </div>
          <p class="content">{{ row.content }}</p>
          <div class="item-foot">
            <span class="meta">
              {{ row.user ? `${row.user.name}（${row.user.email}）` : '未登录用户' }} · <span :title="formatDateTime(row.createdAt)">{{ relativeTime(row.createdAt, now) }}</span>
              <template v-if="row.status !== 'open' && row.handledAt"> · {{ FEEDBACK_STATUS_LABELS[row.status] }}于 {{ relativeTime(row.handledAt, now) }}</template>
            </span>
            <span class="actions">
              <a v-if="row.question.published" :href="row.question.path" target="_blank" rel="noopener" class="btn btn-sm btn-ghost">看前台<AdminIcon name="external" :size="14" /></a>
              <NuxtLink :to="`/admin/questions/${row.question.id}`" class="btn btn-sm">改题</NuxtLink>
              <template v-if="row.status === 'open'">
                <button type="button" class="btn btn-sm btn-ghost" :disabled="busyId === row.id" @click="mark(row, 'ignored')">忽略</button>
                <button type="button" class="btn btn-sm btn-primary" :disabled="busyId === row.id" @click="mark(row, 'resolved')">已处理</button>
              </template>
              <button v-else type="button" class="btn btn-sm btn-ghost" :disabled="busyId === row.id" @click="mark(row, 'open')">重新打开</button>
            </span>
          </div>
        </li>
      </ul>
      <p v-else class="a-empty">{{ status === 'open' ? '没有待处理的反馈' : '这里还没有反馈' }}</p>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--c-divider);
}

.total {
  font-size: 13px;
  color: var(--c-text-3);
}

.items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-bottom: 1px solid var(--c-divider);
}

.item:last-child {
  border-bottom: 0;
}

.item-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
}

.kind {
  flex: none;
  padding: 1px 8px;
  border-radius: var(--r-full);
  background: var(--c-bg-mute);
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-2);
}

.kind.error {
  background: color-mix(in srgb, var(--st-weak) 14%, transparent);
  color: var(--st-weak-text);
}

.kind.outdated {
  background: color-mix(in srgb, var(--st-fuzzy) 18%, transparent);
  color: var(--st-fuzzy-text);
}

.q-title {
  font-weight: 600;
  color: var(--c-text-1);
}

.q-title:hover {
  color: var(--c-brand);
}

.q-cat {
  font-size: 12px;
  color: var(--c-text-3);
}

.content {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.item-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}

.meta {
  font-size: 12px;
  color: var(--c-text-3);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
