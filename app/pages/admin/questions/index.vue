<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '题目管理 | 全栈面试手册' })

interface Row {
  id: number
  slug: string
  title: string
  difficulty: number
  tags: string[]
  status: 'draft' | 'published'
  sort: number
  updatedAt: string
  partTitle: string
  categoryTitle: string
  path: string
}

const route = useRoute()
const { structure } = useAdminStructure()

const filters = reactive({
  // 从分类管理页点"题目数"跳过来时带着 categoryId
  categoryId: route.query.categoryId ? Number(route.query.categoryId) : (undefined as number | undefined),
  status: undefined as 'draft' | 'published' | undefined,
  q: '',
  page: 1,
  pageSize: 20,
})

const query = computed(() => ({
  categoryId: filters.categoryId,
  status: filters.status,
  q: filters.q.trim() || undefined,
  page: filters.page,
  pageSize: filters.pageSize,
}))

const { data, pending, refresh } = await useFetch<{ total: number; items: Row[] }>('/api/admin/questions', {
  query,
  default: () => ({ total: 0, items: [] }),
})

// 修改筛选条件时回到第一页
watch(
  () => [filters.categoryId, filters.status, filters.q],
  () => (filters.page = 1),
)

async function remove(row: Row) {
  try {
    await ElMessageBox.confirm(`删除后，所有用户在这道题上的学习记录和面试记录也会一起删除。确定删除"${plainTitle(row.title)}"吗？`, '删除题目', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await $fetch(`/api/admin/questions/${row.id}`, { method: 'DELETE' })
    ElMessage.success('已删除')
    refresh()
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
}

const formatTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false })
</script>

<template>
  <div>
    <div class="page-head">
      <h1>题目管理</h1>
      <ElButton type="primary" @click="navigateTo('/admin/questions/new')">新建题目</ElButton>
    </div>

    <div class="toolbar card">
      <ElSelect v-model="filters.categoryId" placeholder="全部分类" clearable filterable style="width: 220px">
        <ElOptionGroup v-for="part in structure" :key="part.id" :label="part.title">
          <ElOption v-for="cat in part.categories" :key="cat.id" :label="cat.title" :value="cat.id" />
        </ElOptionGroup>
      </ElSelect>
      <ElSelect v-model="filters.status" placeholder="全部状态" clearable style="width: 130px">
        <ElOption label="已发布" value="published" />
        <ElOption label="草稿" value="draft" />
      </ElSelect>
      <ElInput v-model="filters.q" placeholder="按题目搜索" clearable style="width: 240px" />
      <span class="total">共 {{ data.total }} 道</span>
    </div>

    <div class="card table-card">
      <ElTable v-loading="pending" :data="data.items" row-key="id" style="width: 100%">
        <ElTableColumn prop="id" label="ID" width="70" />
        <ElTableColumn label="题目" min-width="300">
          <template #default="{ row }">
            <NuxtLink :to="`/admin/questions/${row.id}`" class="title-link"><RichTitle :title="row.title" /></NuxtLink>
            <div class="slug">{{ row.slug }}</div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="分类" width="170">
          <template #default="{ row }">{{ row.partTitle }} / {{ row.categoryTitle }}</template>
        </ElTableColumn>
        <ElTableColumn label="难度" width="90">
          <template #default="{ row }"><span class="stars" :title="DIFFICULTY_LABELS[row.difficulty]">{{ '★'.repeat(row.difficulty) }}</span></template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="90">
          <template #default="{ row }">
            <ElTag :type="row.status === 'published' ? 'success' : 'info'" size="small">
              {{ row.status === 'published' ? '已发布' : '草稿' }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="sort" label="排序" width="80" />
        <ElTableColumn label="更新时间" width="170">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" @click="navigateTo(`/admin/questions/${row.id}`)">编辑</ElButton>
            <ElButton v-if="row.status === 'published'" link @click="navigateTo(row.path, { open: { target: '_blank' } })">查看</ElButton>
            <ElButton link type="danger" @click="remove(row)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div class="pager">
        <ElPagination
          v-model:current-page="filters.page"
          v-model:page-size="filters.pageSize"
          :total="data.total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

h1 {
  margin: 0;
  font-size: 22px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px 16px;
  background: var(--c-bg-elv);
}

.total {
  margin-left: auto;
  font-size: 13px;
  color: var(--c-text-2);
}

.table-card {
  padding: 8px 8px 16px;
  background: var(--c-bg-elv);
}

.title-link {
  font-weight: 500;
  color: var(--c-text-1);
}

.title-link:hover {
  color: var(--c-brand);
}

.slug {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--c-text-3);
}

.stars {
  color: var(--st-fuzzy);
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
