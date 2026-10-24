<script setup lang="ts">
import type { TableInstance } from 'element-plus'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '题目' })

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

interface BatchResult {
  changed: number
  skipped: number
  failed: { id: number; title: string; message: string }[]
  sync: { synced: boolean; error?: string }
}

type Status = 'draft' | 'published' | undefined

const route = useRoute()
const router = useRouter()
const { structure } = useAdminStructure()

const filters = reactive({
  // 从分类页点"题目数"、从概览点"查看草稿"跳过来时带着筛选条件
  categoryId: route.query.categoryId ? Number(route.query.categoryId) : (undefined as number | undefined),
  status: (['draft', 'published'].includes(String(route.query.status)) ? route.query.status : undefined) as Status,
  q: typeof route.query.q === 'string' ? route.query.q : '',
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

// 修改筛选条件时回到第一页，并写进网址，刷新和分享链接时保留
watch(
  () => [filters.categoryId, filters.status, filters.q],
  () => {
    filters.page = 1
    router.replace({ query: { categoryId: filters.categoryId, status: filters.status, q: filters.q.trim() || undefined } })
  },
)

const STATUS_TABS: { value: Status; label: string }[] = [
  { value: undefined, label: '全部' },
  { value: 'published', label: '已发布' },
  { value: 'draft', label: '草稿' },
]

// ---------- 选择和批量操作 ----------
const table = ref<TableInstance>()
const selected = ref<Row[]>([])
const busy = ref(false)
watch(data, () => clearSelection())

function clearSelection() {
  table.value?.clearSelection()
  selected.value = []
}

async function runBatch(action: 'publish' | 'draft' | 'move' | 'delete', extra: { categoryId?: number } = {}) {
  const ids = selected.value.map((r) => r.id)
  busy.value = true
  try {
    const result = await $fetch<BatchResult>('/api/admin/questions/batch', { method: 'POST', body: { action, ids, ...extra } })
    const verb = { publish: '发布', draft: '转为草稿', move: '移动', delete: '删除' }[action]
    const skipped = result.skipped ? `，${result.skipped} 道不需要改动` : ''
    ElMessage.success(`已${verb} ${result.changed} 道${skipped}`)
    if (result.failed.length) {
      ElMessageBox.alert(result.failed.map((f) => `${plainTitle(f.title)}：${f.message}`).join('\n'), `${result.failed.length} 道没有${verb}`, {
        type: 'warning',
      })
    }
    if (result.sync.error) ElMessage.warning(`数据库已更新，但写回 content 文件失败：${result.sync.error}`)
    clearSelection()
    await refresh()
    refreshNuxtData(['outline', 'admin-structure'])
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    busy.value = false
  }
}

async function batchDelete() {
  try {
    await ElMessageBox.confirm(
      `删除后，所有用户在这 ${selected.value.length} 道题上的学习记录、复习记录和面试记录也会一起删除，不能恢复。`,
      `删除 ${selected.value.length} 道题？`,
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return
  }
  runBatch('delete')
}

const moveDialog = reactive({ open: false, categoryId: undefined as number | undefined })
function confirmMove() {
  if (!moveDialog.categoryId) return
  moveDialog.open = false
  runBatch('move', { categoryId: moveDialog.categoryId })
}

// ---------- 单题操作 ----------
async function remove(row: Row) {
  try {
    await ElMessageBox.confirm(
      `删除后，所有用户在这道题上的学习记录和面试记录也会一起删除。确定删除"${plainTitle(row.title)}"吗？`,
      '删除题目',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' },
    )
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

function onMore(command: string, row: Row) {
  if (command === 'history') navigateTo({ path: `/admin/questions/${row.id}`, query: { panel: 'history' } })
  else if (command === 'copy') {
    navigator.clipboard.writeText(location.origin + row.path).then(() => ElMessage.success('已复制链接'))
  } else if (command === 'delete') remove(row)
}
</script>

<template>
  <div>
    <AdminPageHead eyebrow="内容" title="题目">
      <template #desc>
        共 <strong class="a-num">{{ data.total }}</strong> 道{{ filters.status || filters.categoryId || filters.q ? '符合条件' : '' }}；点标题进入编辑。
      </template>
      <NuxtLink to="/admin/questions/new" class="btn btn-sm btn-primary"><AdminIcon name="plus" :size="15" />新建题目</NuxtLink>
    </AdminPageHead>

    <div class="a-card list">
      <div class="filters">
        <div class="a-seg" role="group" aria-label="按状态筛选">
          <button
            v-for="t in STATUS_TABS"
            :key="t.label"
            type="button"
            :aria-pressed="filters.status === t.value"
            @click="filters.status = t.value"
          >
            {{ t.label }}
          </button>
        </div>
        <ElSelect v-model="filters.categoryId" placeholder="全部分类" clearable filterable class="cat-select">
          <ElOptionGroup v-for="part in structure" :key="part.id" :label="part.title">
            <ElOption v-for="cat in part.categories" :key="cat.id" :label="cat.title" :value="cat.id" />
          </ElOptionGroup>
        </ElSelect>
        <ElInput v-model="filters.q" placeholder="搜索题目" clearable class="search">
          <template #prefix><AdminIcon name="search" :size="16" /></template>
        </ElInput>
      </div>

      <ElTable
        ref="table"
        v-loading="pending"
        :data="data.items"
        row-key="id"
        class="a-table"
        style="width: 100%"
        @selection-change="(rows: Row[]) => (selected = rows)"
      >
        <ElTableColumn type="selection" width="48" />
        <ElTableColumn label="题目" min-width="340">
          <template #default="{ row }">
            <NuxtLink :to="`/admin/questions/${row.id}`" class="title-link"><RichTitle :title="row.title" /></NuxtLink>
            <div class="row-meta">
              <span>{{ row.partTitle }} / {{ row.categoryTitle }}</span>
              <span class="a-mono">#{{ row.id }} · {{ row.slug }}</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="难度" width="100">
          <template #default="{ row }"><AdminLevel :value="row.difficulty" /></template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="100">
          <template #default="{ row }"><AdminStatusChip :status="row.status" /></template>
        </ElTableColumn>
        <ElTableColumn label="更新" width="110">
          <template #default="{ row }">
            <time class="time" :datetime="row.updatedAt" :title="formatDateTime(row.updatedAt)">{{ relativeTime(row.updatedAt) }}</time>
          </template>
        </ElTableColumn>
        <ElTableColumn label="" width="132" align="right">
          <template #default="{ row }">
            <div class="row-actions">
              <NuxtLink :to="`/admin/questions/${row.id}`" class="a-icon-btn" title="编辑" aria-label="编辑"><AdminIcon name="edit" :size="17" /></NuxtLink>
              <a :href="row.path" target="_blank" rel="noopener" class="a-icon-btn" :title="row.status === 'published' ? '在前台查看' : '草稿在前台看不到'" aria-label="在前台查看" :class="{ off: row.status !== 'published' }">
                <AdminIcon name="external" :size="17" />
              </a>
              <ElDropdown trigger="click" placement="bottom-end" @command="(c: string) => onMore(c, row as Row)">
                <button type="button" class="a-icon-btn" title="更多" aria-label="更多操作"><AdminIcon name="more" :size="18" /></button>
                <template #dropdown>
                  <ElDropdownMenu>
                    <ElDropdownItem command="history">修改历史</ElDropdownItem>
                    <ElDropdownItem command="copy">复制前台链接</ElDropdownItem>
                    <ElDropdownItem command="delete" divided class="danger-item">删除题目</ElDropdownItem>
                  </ElDropdownMenu>
                </template>
              </ElDropdown>
            </div>
          </template>
        </ElTableColumn>
        <template #empty>
          <p class="a-empty">没有符合条件的题目</p>
        </template>
      </ElTable>

      <div class="pager">
        <ElPagination
          v-model:current-page="filters.page"
          v-model:page-size="filters.pageSize"
          :total="data.total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          :pager-count="5"
          background
        />
      </div>
    </div>

    <!-- 批量操作条：选中题目后出现在底部 -->
    <Transition name="bulk">
      <div v-if="selected.length" class="bulk" role="region" aria-label="批量操作">
        <span class="bulk-count">已选 <strong class="a-num">{{ selected.length }}</strong> 道</span>
        <span class="bulk-sep" />
        <button type="button" :disabled="busy" @click="runBatch('publish')"><AdminIcon name="check" :size="16" />发布</button>
        <button type="button" :disabled="busy" @click="runBatch('draft')"><AdminIcon name="eyeOff" :size="16" />转为草稿</button>
        <button type="button" :disabled="busy" @click="moveDialog.open = true"><AdminIcon name="folder" :size="16" />移动到…</button>
        <button type="button" class="danger" :disabled="busy" @click="batchDelete"><AdminIcon name="trash" :size="16" />删除</button>
        <span class="bulk-sep" />
        <button type="button" class="close" title="取消选择" aria-label="取消选择" @click="clearSelection"><AdminIcon name="close" :size="16" /></button>
      </div>
    </Transition>

    <ElDialog v-model="moveDialog.open" title="移动到分类" width="420px" append-to-body>
      <p class="dialog-tip">选中的 {{ selected.length }} 道题会排在目标分类的最后，网址会跟着变。</p>
      <ElSelect v-model="moveDialog.categoryId" placeholder="选择分类" filterable style="width: 100%">
        <ElOptionGroup v-for="part in structure" :key="part.id" :label="part.title">
          <ElOption v-for="cat in part.categories" :key="cat.id" :label="cat.title" :value="cat.id" />
        </ElOptionGroup>
      </ElSelect>
      <template #footer>
        <ElButton @click="moveDialog.open = false">取消</ElButton>
        <ElButton type="primary" :disabled="!moveDialog.categoryId" @click="confirmMove">移动</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.list {
  overflow: hidden;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--c-divider);
}

.cat-select {
  width: 200px;
}

.search {
  width: 240px;
  margin-left: auto;
}

.title-link {
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--c-text-1);
}

.title-link:hover {
  color: var(--c-brand);
}

.row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  margin-top: 2px;
  font-size: 12.5px;
  color: var(--c-text-3);
}

.time {
  font-size: 13px;
  color: var(--c-text-2);
}

.row-actions {
  display: inline-flex;
  gap: 2px;
}

.a-icon-btn.off {
  opacity: 0.35;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 14px 16px;
  border-top: 1px solid var(--c-divider);
}

:global(.danger-item) {
  color: var(--c-danger) !important;
}

/* ---------- 批量操作条 ---------- */
.bulk {
  position: fixed;
  bottom: 24px;
  left: calc(50% + 116px);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px;
  border-radius: var(--r-lg);
  background: var(--c-ink);
  box-shadow: var(--shadow-lg);
  color: var(--c-on-ink);
  transform: translateX(-50%);
}

.bulk-count {
  padding: 0 10px 0 12px;
  font-size: 13.5px;
  white-space: nowrap;
}

.bulk-count strong {
  font-size: 16px;
}

.bulk-sep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: color-mix(in srgb, var(--c-on-ink) 22%, transparent);
}

.bulk button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: inherit;
  font-size: 13.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}

.bulk button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--c-on-ink) 12%, transparent);
}

.bulk button.danger:hover:not(:disabled) {
  background: var(--st-weak);
  color: #fff;
}

.bulk button.close {
  width: 34px;
  padding: 0;
  justify-content: center;
}

.bulk button:disabled {
  opacity: 0.5;
  cursor: wait;
}

.bulk-enter-active,
.bulk-leave-active {
  transition:
    opacity var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}

.bulk-enter-from,
.bulk-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}

.dialog-tip {
  margin: 0 0 12px;
  font-size: 13.5px;
  color: var(--c-text-2);
}

@media (max-width: 860px) {
  .bulk {
    left: 50%;
    max-width: calc(100vw - 24px);
    overflow-x: auto;
  }

  .search {
    width: 100%;
    margin-left: 0;
  }

  .cat-select {
    flex: 1;
  }
}
</style>
