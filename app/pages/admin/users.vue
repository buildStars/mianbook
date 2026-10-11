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
}

const { user: me } = useUserSession()
const { data: users, refresh } = await useFetch<UserRow[]>('/api/admin/users', { default: () => [] })

async function changeRole(row: UserRow, role: 'admin' | 'user') {
  try {
    await $fetch(`/api/admin/users/${row.id}`, { method: 'PUT', body: { role } })
    ElMessage.success('已更新')
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
  refresh()
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('zh-CN')
</script>

<template>
  <div>
    <h1>用户</h1>
    <div class="card table-card">
      <ElTable :data="users">
        <ElTableColumn prop="id" label="ID" width="70" />
        <ElTableColumn label="昵称" min-width="140">
          <template #default="{ row }">
            {{ row.name }}<ElTag v-if="row.id === me?.id" size="small" class="me">我</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="email" label="邮箱" min-width="200" />
        <ElTableColumn label="角色" width="150">
          <template #default="{ row }">
            <ElSelect :model-value="row.role" size="small" :disabled="row.id === me?.id" @change="(v: 'admin' | 'user') => changeRole(row, v)">
              <ElOption label="管理员" value="admin" />
              <ElOption label="普通用户" value="user" />
            </ElSelect>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="mastered" label="已掌握" width="90" />
        <ElTableColumn prop="interviews" label="AI 面试" width="90" />
        <ElTableColumn label="注册时间" width="120">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </ElTableColumn>
      </ElTable>
    </div>
  </div>
</template>

<style scoped>
h1 {
  margin: 0 0 16px;
  font-size: 22px;
}

.table-card {
  padding: 8px;
  background: var(--c-bg-elv);
}

.me {
  margin-left: 6px;
}
</style>
