<script setup lang="ts">
import type { AdminCategory, AdminPart } from '~/composables/useAdminStructure'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '分类管理 | 全栈面试手册' })

const { structure, refresh } = useAdminStructure()

type Kind = 'part' | 'category'
const dialog = reactive({
  open: false,
  kind: 'part' as Kind,
  id: null as number | null,
  form: { partId: undefined as number | undefined, slug: '', title: '', sort: 0 },
})
const saving = ref(false)

function openPart(part?: AdminPart) {
  Object.assign(dialog, {
    open: true,
    kind: 'part',
    id: part?.id ?? null,
    form: { partId: undefined, slug: part?.slug ?? '', title: part?.title ?? '', sort: part?.sort ?? structure.value.length },
  })
}

function openCategory(part: AdminPart, cat?: AdminCategory) {
  Object.assign(dialog, {
    open: true,
    kind: 'category',
    id: cat?.id ?? null,
    form: { partId: cat?.partId ?? part.id, slug: cat?.slug ?? '', title: cat?.title ?? '', sort: cat?.sort ?? part.categories.length },
  })
}

async function save() {
  saving.value = true
  const base = dialog.kind === 'part' ? '/api/admin/parts' : '/api/admin/categories'
  const body = dialog.kind === 'part' ? { slug: dialog.form.slug, title: dialog.form.title, sort: dialog.form.sort } : dialog.form
  try {
    if (dialog.id) await $fetch(`${base}/${dialog.id}`, { method: 'PUT', body })
    else await $fetch(base, { method: 'POST', body })
    dialog.open = false
    ElMessage.success('已保存')
    await refresh()
    refreshNuxtData('outline')
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function remove(kind: Kind, id: number, title: string) {
  try {
    await ElMessageBox.confirm(`确定删除"${title}"吗？`, '删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
    await $fetch(`/api/admin/${kind === 'part' ? 'parts' : 'categories'}/${id}`, { method: 'DELETE' })
    ElMessage.success('已删除')
    await refresh()
    refreshNuxtData('outline')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(errorMessage(error))
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <h1>分类管理</h1>
      <ElButton type="primary" @click="openPart()">新建部分</ElButton>
    </div>
    <p class="muted intro">网址由"部分 slug / 分类 slug / 题目 slug"组成。修改 slug 会改变已有题目的网址，旧链接会失效。没有已发布题目的分类不会显示在前台。</p>

    <div v-for="part in structure" :key="part.id" class="card part">
      <div class="part-head">
        <div>
          <h2>{{ part.title }}</h2>
          <span class="meta">/{{ part.slug }} · 排序 {{ part.sort }}</span>
        </div>
        <div>
          <ElButton size="small" @click="openCategory(part)">新建分类</ElButton>
          <ElButton size="small" @click="openPart(part)">编辑</ElButton>
          <ElButton size="small" type="danger" plain @click="remove('part', part.id, part.title)">删除</ElButton>
        </div>
      </div>
      <ElTable :data="part.categories" size="small">
        <ElTableColumn prop="title" label="分类" min-width="160" />
        <ElTableColumn label="slug" min-width="140">
          <template #default="{ row }"><code>{{ row.slug }}</code></template>
        </ElTableColumn>
        <ElTableColumn prop="sort" label="排序" width="80" />
        <ElTableColumn label="题目数" width="90">
          <template #default="{ row }">
            <NuxtLink v-if="row.questionCount" :to="{ path: '/admin/questions', query: { categoryId: row.id } }">{{ row.questionCount }}</NuxtLink>
            <span v-else class="muted">0</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="200">
          <template #default="{ row }">
            <ElButton link type="primary" @click="navigateTo({ path: '/admin/questions/new', query: { categoryId: row.id } })">加题</ElButton>
            <ElButton link @click="openCategory(part, row)">编辑</ElButton>
            <ElButton link type="danger" :disabled="row.questionCount > 0" @click="remove('category', row.id, row.title)">删除</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <ElDialog v-model="dialog.open" :title="`${dialog.id ? '编辑' : '新建'}${dialog.kind === 'part' ? '部分' : '分类'}`" width="440px">
      <ElForm label-position="top" @submit.prevent="save">
        <ElFormItem v-if="dialog.kind === 'category'" label="所属部分">
          <ElSelect v-model="dialog.form.partId" style="width: 100%">
            <ElOption v-for="p in structure" :key="p.id" :label="p.title" :value="p.id" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="名称">
          <ElInput v-model="dialog.form.title" maxlength="64" />
        </ElFormItem>
        <ElFormItem label="slug">
          <ElInput v-model="dialog.form.slug" placeholder="小写字母、数字和连字符" />
        </ElFormItem>
        <ElFormItem label="排序">
          <ElInputNumber v-model="dialog.form.sort" :min="0" controls-position="right" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialog.open = false">取消</ElButton>
        <ElButton type="primary" :loading="saving" @click="save">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h1 {
  margin: 0;
  font-size: 22px;
}

.intro {
  margin: 8px 0 16px;
  font-size: 13px;
}

.part {
  margin-bottom: 16px;
  padding: 16px 16px 8px;
  background: var(--c-bg-elv);
}

.part-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.part-head h2 {
  margin: 0;
  font-size: 16px;
}

.meta {
  font-size: 12px;
  color: var(--c-text-3);
}

code {
  font-family: var(--font-mono);
  font-size: 12px;
}
</style>
