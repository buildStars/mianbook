<script setup lang="ts">
import type { AdminUserRow } from '#shared/types/admin'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '用户' })

const { user: me } = useUserSession()
const { data: users, refresh } = await useFetch<AdminUserRow[]>('/api/admin/users', { default: () => [] })

const q = ref('')
const filtered = computed(() => {
  const k = q.value.trim().toLowerCase()
  return k ? users.value.filter((u) => u.name.toLowerCase().includes(k) || u.email.toLowerCase().includes(k)) : users.value
})
const admins = computed(() => users.value.filter((u) => u.role === 'admin').length)
const disabled = computed(() => users.value.filter((u) => u.disabledAt).length)

/** 正在看详情的用户 */
const viewing = ref<number | null>(null)

async function changeRole(row: AdminUserRow, role: 'admin' | 'user') {
  try {
    await $fetch(`/api/admin/users/${row.id}`, { method: 'PUT', body: { role } })
    ElMessage.success(role === 'admin' ? `已把 ${row.name} 设为管理员` : `已取消 ${row.name} 的管理员权限`)
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
  refresh()
}

const rowClass = ({ row }: { row: AdminUserRow }) => (row.disabledAt ? 'is-disabled' : '')
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('zh-CN')
</script>

<template>
  <div>
    <AdminPageHead eyebrow="系统" title="用户">
      <template #desc>
        共 <strong class="a-num">{{ users.length }}</strong> 位用户，其中 {{ admins }} 位管理员<template v-if="disabled">、{{ disabled }} 位已停用</template>。点用户可以调整 AI 次数、强制下线、停用账号。
      </template>
    </AdminPageHead>

    <AdminRegisterSettings />

    <div class="a-card list">
      <div class="filters">
        <ElInput v-model="q" placeholder="按昵称或邮箱搜索" clearable class="search">
          <template #prefix><AdminIcon name="search" :size="16" /></template>
        </ElInput>
      </div>
      <ElTable :data="filtered" class="a-table" row-key="id" :row-class-name="rowClass">
        <ElTableColumn label="用户" min-width="220">
          <template #default="{ row }">
            <button type="button" class="who" @click="viewing = row.id">
              <span class="avatar serif" :class="{ admin: row.role === 'admin' }" aria-hidden="true">{{ row.name.slice(0, 1) }}</span>
              <span class="who-text">
                <strong>
                  {{ row.name }}<span v-if="row.id === me?.id" class="me">我</span><span v-if="row.disabledAt" class="off">已停用</span>
                </strong>
                <span>{{ row.email }}<em v-if="row.emailVerified" class="verified" title="注册时通过了邮箱验证">已验证</em></span>
              </span>
            </button>
          </template>
        </ElTableColumn>
        <ElTableColumn label="角色" width="130">
          <template #default="{ row }">
            <ElSelect :model-value="row.role" size="small" :disabled="row.id === me?.id" @change="(v: 'admin' | 'user') => changeRole(row as AdminUserRow, v)">
              <ElOption label="管理员" value="admin" />
              <ElOption label="普通用户" value="user" />
            </ElSelect>
          </template>
        </ElTableColumn>
        <ElTableColumn label="AI · 24 小时" width="130">
          <template #default="{ row }">
            <span class="quota" :title="row.aiLimitCustom === null ? '跟随全站设置' : '单独设置的次数'">
              <span class="a-num n">{{ row.aiUsed24h }}</span><span v-if="row.aiLimitCustom !== 0" class="of">/ {{ row.aiLimit }}</span>
              <em v-if="row.aiLimitCustom === 0" class="tag bad">已关闭</em>
              <em v-else-if="row.aiLimitCustom !== null" class="tag">单独</em>
            </span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="已掌握" width="80" align="right">
          <template #default="{ row }"><span class="a-num n">{{ row.mastered }}</span></template>
        </ElTableColumn>
        <ElTableColumn label="AI 面试" width="80" align="right">
          <template #default="{ row }"><span class="a-num n">{{ row.interviews }}</span></template>
        </ElTableColumn>
        <ElTableColumn label="AI 调用 · 30 天" width="120" align="right">
          <template #default="{ row }"><span class="a-num n">{{ row.aiCalls30d }}</span></template>
        </ElTableColumn>
        <ElTableColumn label="最近活跃" width="110">
          <template #default="{ row }">
            <time v-if="row.lastActiveAt" class="time" :datetime="row.lastActiveAt" :title="formatDateTime(row.lastActiveAt)">{{ relativeTime(row.lastActiveAt) }}</time>
            <span v-else class="time none">没有记录</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="注册" width="100">
          <template #default="{ row }"><span class="time">{{ formatDate(row.createdAt) }}</span></template>
        </ElTableColumn>
        <ElTableColumn label="" width="84" align="right" fixed="right">
          <template #default="{ row }">
            <button type="button" class="btn btn-sm manage" :aria-label="`管理 ${row.name}`" @click="viewing = row.id">管理</button>
          </template>
        </ElTableColumn>
        <template #empty>
          <p class="a-empty">没有找到用户</p>
        </template>
      </ElTable>
    </div>

    <AdminUserDrawer :user-id="viewing" @close="viewing = null" @changed="refresh()" />
  </div>
</template>

<style scoped>
.list {
  overflow: hidden;
}

.filters {
  display: flex;
  padding: 14px 16px;
  border-bottom: 1px solid var(--c-divider);
}

.search {
  width: 280px;
}

.who {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.who:hover strong {
  color: var(--c-brand);
}

.who:focus-visible {
  border-radius: var(--r-sm);
  outline: 2px solid var(--c-brand);
  outline-offset: 2px;
}

.avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--c-bg-mute);
  font-size: 14px;
  font-weight: 700;
  color: var(--c-text-1);
}

.avatar.admin {
  background: var(--c-ink);
  color: var(--c-on-ink);
}

.who-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.4;
}

.who-text strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-1);
  transition: color var(--dur-fast);
}

.who-text > span {
  overflow: hidden;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-3);
}

.me,
.off {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: var(--r-xs);
  font-size: 11px;
  font-weight: 600;
}

.me {
  background: var(--c-brand-soft);
  color: var(--c-brand);
}

.off {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.verified {
  margin-left: 6px;
  font-style: normal;
  font-size: 11px;
  color: var(--c-success);
}

.n {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text-1);
}

.quota {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.of {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.tag {
  margin-left: 4px;
  padding: 0 6px;
  border-radius: var(--r-xs);
  background: var(--c-default-soft);
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
  color: var(--c-text-2);
}

.tag.bad {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.time {
  font-size: 13px;
  color: var(--c-text-2);
}

.time.none {
  color: var(--c-text-3);
}

.manage {
  height: 28px;
}

/* 停用的账号：头像和数字变淡，名字和"已停用"标记保持清楚 */
.list :deep(.is-disabled .avatar),
.list :deep(.is-disabled .n),
.list :deep(.is-disabled .quota),
.list :deep(.is-disabled .time) {
  opacity: 0.55;
}

@media (max-width: 640px) {
  .search {
    width: 100%;
  }
}
</style>
