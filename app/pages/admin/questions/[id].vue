<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })

interface QuestionForm {
  categoryId: number | undefined
  slug: string
  title: string
  difficulty: number
  tags: string[]
  contentMd: string
  sort: number | undefined
  status: 'draft' | 'published'
}

const TEMPLATE = `::: tip 一句话回答
面试时开口先说的两三句话，讲清结论。
:::

## 详细解析

### 小标题

原理、流程、对比表格写在这里。

## 代码示例

\`\`\`js
// 示例代码
\`\`\`

## 面试官可能追问

::: details 追问的问题？
答案默认折叠，复习时可以先自己想，再展开。
:::

## 易错点

- 容易答错或混淆的地方
`

const TAG_OPTIONS = ['高频', '原理', '手写题', '输出题', '场景题', '性能优化', '安全', '综合', '实践', '新特性']

const route = useRoute()
const isNew = computed(() => route.params.id === 'new')
const { structure } = useAdminStructure()

const form = reactive<QuestionForm>({
  categoryId: route.query.categoryId ? Number(route.query.categoryId) : undefined,
  slug: '',
  title: '',
  difficulty: 2,
  tags: [],
  contentMd: TEMPLATE,
  sort: undefined,
  status: 'draft',
})
const path = ref('')
const saving = ref(false)
const dirty = ref(false)

if (!isNew.value) {
  const { data, error } = await useFetch<QuestionForm & { path: string }>(`/api/admin/questions/${route.params.id}`)
  if (error.value || !data.value) throw createError({ statusCode: 404, statusMessage: '题目不存在', fatal: true })
  Object.assign(form, {
    categoryId: data.value.categoryId,
    slug: data.value.slug,
    title: data.value.title,
    difficulty: data.value.difficulty,
    tags: data.value.tags,
    contentMd: data.value.contentMd,
    sort: data.value.sort,
    status: data.value.status,
  })
  path.value = data.value.path
}

useHead(() => ({ title: `${isNew.value ? '新建题目' : '编辑题目'} | 全栈面试手册` }))

watch(form, () => (dirty.value = true), { deep: true })

// 离开页面时提醒未保存的修改
onBeforeRouteLeave(() => {
  if (dirty.value && !confirm('还有修改没有保存，确定离开吗？')) return false
})

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const body = { ...form, title: form.title.trim(), slug: form.slug.trim() }
    if (isNew.value) {
      const { id } = await $fetch<{ id: number }>('/api/admin/questions', { method: 'POST', body })
      dirty.value = false
      ElMessage.success('已创建')
      await navigateTo(`/admin/questions/${id}`, { replace: true })
    } else {
      await $fetch(`/api/admin/questions/${route.params.id}`, { method: 'PUT', body })
      dirty.value = false
      const cat = structure.value.flatMap((p) => p.categories.map((c) => ({ ...c, partSlug: p.slug }))).find((c) => c.id === form.categoryId)
      if (cat) path.value = `/${cat.partSlug}/${cat.slug}/${body.slug}`
      ElMessage.success(form.status === 'published' ? '已保存并发布' : '已保存为草稿')
    }
    // 目录有变化，刷新前台缓存的目录
    refreshNuxtData('outline')
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="editor-page">
    <div class="page-head">
      <div>
        <NuxtLink to="/admin/questions" class="back">← 题目列表</NuxtLink>
        <h1>{{ isNew ? '新建题目' : '编辑题目' }}</h1>
      </div>
      <div class="actions">
        <span v-if="dirty" class="dirty">未保存</span>
        <ElButton v-if="path && form.status === 'published' && !dirty" @click="navigateTo(path, { open: { target: '_blank' } })">
          查看页面
        </ElButton>
        <ElButton type="primary" :loading="saving" @click="save">保存（Ctrl + S）</ElButton>
      </div>
    </div>

    <div class="card form">
      <ElForm label-position="top" @submit.prevent="save">
        <div class="grid">
          <ElFormItem label="题目" class="span-2">
            <ElInput v-model="form.title" maxlength="255" placeholder="用问句，例如：什么是闭包？有哪些应用场景？" />
          </ElFormItem>
          <ElFormItem label="分类">
            <ElSelect v-model="form.categoryId" placeholder="选择分类" filterable>
              <ElOptionGroup v-for="part in structure" :key="part.id" :label="part.title">
                <ElOption v-for="cat in part.categories" :key="cat.id" :label="cat.title" :value="cat.id" />
              </ElOptionGroup>
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="slug（出现在网址里）">
            <ElInput v-model="form.slug" placeholder="例如 closure，只能用小写字母、数字和连字符" />
          </ElFormItem>
          <ElFormItem label="难度">
            <ElRadioGroup v-model="form.difficulty">
              <ElRadioButton v-for="n in 3" :key="n" :value="n">{{ DIFFICULTY_LABELS[n] }}</ElRadioButton>
            </ElRadioGroup>
          </ElFormItem>
          <ElFormItem label="标签">
            <ElSelect v-model="form.tags" multiple filterable allow-create :multiple-limit="6" placeholder="选择或输入标签">
              <ElOption v-for="t in TAG_OPTIONS" :key="t" :label="t" :value="t" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="排序（越小越靠前，留空排在分类末尾）">
            <ElInputNumber v-model="form.sort" :min="0" :step="10" controls-position="right" />
          </ElFormItem>
          <ElFormItem label="状态">
            <ElRadioGroup v-model="form.status">
              <ElRadioButton value="draft">草稿</ElRadioButton>
              <ElRadioButton value="published">发布</ElRadioButton>
            </ElRadioGroup>
          </ElFormItem>
        </div>
      </ElForm>
    </div>

    <AdminMarkdownEditor v-model="form.contentMd" @save="save" />
    <p class="hint">正文不用写一级标题，题目会单独显示。支持 <code>::: tip 标题</code> 提示块和 <code>::: details 问题</code> 折叠追问。</p>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.back {
  font-size: 13px;
  color: var(--c-text-2);
}

h1 {
  margin: 4px 0 0;
  font-size: 22px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dirty {
  font-size: 13px;
  color: var(--c-warning);
}

.form {
  margin-bottom: 16px;
  padding: 16px 20px 0;
  background: var(--c-bg-elv);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0 20px;
}

.span-2 {
  grid-column: 1 / -1;
}

.grid :deep(.el-select),
.grid :deep(.el-input-number) {
  width: 100%;
}

.hint {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--c-text-2);
}

.hint code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--c-default-soft);
  font-family: var(--font-mono);
}
</style>
