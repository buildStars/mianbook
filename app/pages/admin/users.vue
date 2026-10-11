<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '用户 | 全栈面试手册' })

interface UserRow {
  id: number
  email: string
  name: string
  role: 'admin' | 'user'
  createdAt: string
  mastered: number
  interviews: number
  aiCalls30d: number
  lastActiveAt: string | null
}

const { user: me } = useUserSession()
const { data: users, refresh } = await useFetch<UserRow[]>('/api/admin/users', { default: () => [] })

const q = ref('')
const filtered = computed(() => {
  const k = q.value.trim().toLowerCase()
  return k ? users.value.filter((u) => u.name.toLowerCase().includes(k) || u.email.toLowerCase().includes(k)) : users.value
})
const admins = computed(() => users.value.filter((u) => u.role === 'admin').length)

async function changeRole(row: UserRow, role: 'admin' | 'user') {
  try {
    await $fetch(`/api/admin/users/${row.id}`, { method: 'PUT', body: { role } })
    ElMessage.success(role === 'admin' ? `已把 ${row.name} 设为管理员` : `已取消 ${row.name} 的管理员权限`)
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
  refresh()
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('zh-CN')
</script>

<template>
  <div>
    <AdminPageHead eyebrow="系统" title="用户">
      <template #desc>共 <strong class="a-num">{{ users.length }}</strong> 位用户，其中 {{ admins }} 位管理员。不能修改自己的角色。</template>
    </AdminPageHead>

    <div class="a-card list">
      <div class="filters">
        <ElInput v-model="q" placeholder="按昵称或邮箱搜索" clearable class="search">
          <template #prefix><AdminIcon name="search" :size="16" /></template>
        </ElInput>
      </div>
      <ElTable :data="filtered" class="a-table" row-key="id">
        <ElTableColumn label="用户" min-width="240">
          <template #default="{ row }">
            <div class="who">
              <span class="avatar serif" :class="{ admin: row.role === 'admin' }" aria-hidden="true">{{ row.name.slice(0, 1) }}</span>
              <span class="who-text">
                <strong>{{ row.name }}<span v-if="row.id === me?.id" class="me">我</span></strong>
                <span>{{ row.email }}</span>
              </span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="角色" width="140">
          <template #default="{ row }">
            <ElSelect :model-value="row.role" size="small" :disabled="row.id === me?.id" @change="(v: 'admin' | 'user') => changeRole(row as UserRow, v)">
              <ElOption label="管理员" value="admin" />
              <ElOption label="普通用户" value="user" />
            </ElSelect>
          </template>
        </ElTableColumn>
        <ElTableColumn label="已掌握" width="90" align="right">
          <template #default="{ row }"><span class="a-num n">{{ row.mastered }}</span></template>
        </ElTableColumn>
        <ElTableColumn label="AI 面试" width="90" align="right">
          <template #default="{ row }"><span class="a-num n">{{ row.interviews }}</span></template>
        </ElTableColumn>
        <ElTableColumn label="AI 调用 · 30 天" width="130" align="right">
          <template #default="{ row }"><span class="a-num n">{{ row.aiCalls30d }}</span></template>
        </ElTableColumn>
        <ElTableColumn label="最近活跃" width="120">
          <template #default="{ row }">
            <time v-if="row.lastActiveAt" class="time" :datetime="row.lastActiveAt" :title="formatDateTime(row.lastActiveAt)">{{ relativeTime(row.lastActiveAt) }}</time>
            <span v-else class="time none">没有记录</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="注册" width="110">
          <template #default="{ row }"><span class="time">{{ formatDate(row.createdAt) }}</span></template>
        </ElTableColumn>
        <template #empty>
          <p class="a-empty">没有找到用户</p>
        </template>
      </ElTable>
    </div>
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
  min-width: 0;
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
}

.who-text > span {
  overflow: hidden;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-3);
}

.me {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: var(--r-xs);
  background: var(--c-brand-soft);
  font-size: 11px;
  font-weight: 600;
  color: var(--c-brand);
}

.n {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text-1);
}

.time {
  font-size: 13px;
  color: var(--c-text-2);
}

.time.none {
  color: var(--c-text-3);
}

@media (max-width: 640px) {
  .search {
    width: 100%;
  }
}
</style>
