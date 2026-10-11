<script setup lang="ts">
import type { AdminCategory, AdminPart } from '~/composables/useAdminStructure'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '分类 | 全栈面试手册' })

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
    await ElMessageBox.confirm(`确定删除"${title}"吗？`, '删除', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
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
    <AdminPageHead eyebrow="内容" title="分类">
      <template #desc>网址由"部分 / 分类 / 题目"三段组成，改 slug 会让旧链接失效。没有已发布题目的分类不会显示在前台。</template>
      <button type="button" class="btn btn-sm btn-primary" @click="openPart()"><AdminIcon name="plus" :size="15" />新建部分</button>
    </AdminPageHead>

    <div class="parts">
      <section v-for="(part, i) in structure" :key="part.id" class="a-card part">
        <header class="part-head">
          <span class="part-no a-num">{{ String(i + 1).padStart(2, '0') }}</span>
          <div class="part-title">
            <h2 class="serif">{{ part.title }}</h2>
            <p>
              <span class="a-mono">/{{ part.slug }}</span>
              · {{ part.categories.length }} 个分类 · {{ part.categories.reduce((s, c) => s + c.questionCount, 0) }} 道题
            </p>
          </div>
          <div class="part-actions">
            <button type="button" class="btn btn-sm" @click="openCategory(part)"><AdminIcon name="plus" :size="15" />分类</button>
            <button type="button" class="a-icon-btn" title="编辑部分" aria-label="编辑部分" @click="openPart(part)"><AdminIcon name="edit" :size="17" /></button>
            <button
              type="button"
              class="a-icon-btn danger"
              :disabled="part.categories.length > 0"
              :title="part.categories.length ? '先删除或移走里面的分类' : '删除部分'"
              aria-label="删除部分"
              @click="remove('part', part.id, part.title)"
            >
              <AdminIcon name="trash" :size="17" />
            </button>
          </div>
        </header>

        <ul v-if="part.categories.length" class="cats">
          <li v-for="cat in part.categories" :key="cat.id" class="cat">
            <div class="cat-main">
              <span class="cat-title">{{ cat.title }}</span>
              <span class="a-mono cat-slug">/{{ part.slug }}/{{ cat.slug }}</span>
            </div>
            <NuxtLink v-if="cat.questionCount" :to="{ path: '/admin/questions', query: { categoryId: cat.id } }" class="count">
              <strong class="a-num">{{ cat.questionCount }}</strong> 道题
            </NuxtLink>
            <span v-else class="count empty">空分类</span>
            <span class="sort" title="排序，越小越靠前">排序 {{ cat.sort }}</span>
            <div class="cat-actions">
              <NuxtLink
                :to="{ path: '/admin/questions/new', query: { categoryId: cat.id } }"
                class="a-icon-btn"
                title="在这个分类下新建题目"
                aria-label="新建题目"
              >
                <AdminIcon name="plus" :size="17" />
              </NuxtLink>
              <button type="button" class="a-icon-btn" title="编辑分类" aria-label="编辑分类" @click="openCategory(part, cat)"><AdminIcon name="edit" :size="17" /></button>
              <button
                type="button"
                class="a-icon-btn danger"
                :disabled="cat.questionCount > 0"
                :title="cat.questionCount ? '分类里还有题目，先移走或删除' : '删除分类'"
                aria-label="删除分类"
                @click="remove('category', cat.id, cat.title)"
              >
                <AdminIcon name="trash" :size="17" />
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="a-empty">还没有分类</p>
      </section>
    </div>

    <ElDialog v-model="dialog.open" :title="`${dialog.id ? '编辑' : '新建'}${dialog.kind === 'part' ? '部分' : '分类'}`" width="440px" append-to-body>
      <ElForm label-position="top" @submit.prevent="save">
        <ElFormItem v-if="dialog.kind === 'category'" label="所属部分">
          <ElSelect v-model="dialog.form.partId" style="width: 100%">
            <ElOption v-for="p in structure" :key="p.id" :label="p.title" :value="p.id" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="名称">
          <ElInput v-model="dialog.form.title" maxlength="64" />
        </ElFormItem>
        <ElFormItem label="slug（出现在网址里）">
          <ElInput v-model="dialog.form.slug" placeholder="小写字母、数字和连字符" spellcheck="false" />
        </ElFormItem>
        <ElFormItem label="排序（越小越靠前）">
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
.parts {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.part {
  overflow: hidden;
}

.part-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  padding: 16px 16px 16px 20px;
  border-bottom: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
}

.part-no {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  color: var(--c-brand);
}

.part-title {
  flex: 1;
  min-width: 200px;
}

.part-title h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.3;
}

.part-title p {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--c-text-3);
}

.part-actions,
.cat-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.part-actions .btn {
  margin-right: 6px;
}

.cats {
  margin: 0;
  padding: 0;
  list-style: none;
}

.cat {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 90px 70px auto;
  align-items: center;
  gap: 12px;
  padding: 10px 16px 10px 20px;
}

.cat + .cat {
  border-top: 1px solid var(--c-divider);
}

.cat:hover {
  background: var(--c-brand-softer);
}

.cat-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 12px;
  min-width: 0;
}

.cat-title {
  font-size: 14.5px;
  font-weight: 600;
}

.cat-slug {
  color: var(--c-text-3);
}

.count {
  font-size: 13px;
  color: var(--c-text-2);
}

.count strong {
  font-size: 15px;
  color: var(--c-brand);
}

.count:hover strong {
  text-decoration: underline;
}

.count.empty {
  color: var(--c-text-3);
}

.sort {
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  color: var(--c-text-3);
}

@media (max-width: 640px) {
  .cat {
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 10px 12px 10px 16px;
  }

  .sort {
    display: none;
  }

  .cat-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
    margin-top: -6px;
  }
}
</style>
