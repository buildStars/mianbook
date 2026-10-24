<script setup lang="ts">
import type { QuestionVersionDetail } from '#shared/types/admin'
import { QUESTION_TAGS, lintQuestionMarkdown, type LintIssue } from '#shared/utils/question-lint'

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

const route = useRoute()
const isNew = computed(() => route.params.id === 'new')
const questionId = computed(() => Number(route.params.id))
const { structure } = useAdminStructure()

const form = reactive<QuestionForm>({
  categoryId: route.query.categoryId ? Number(route.query.categoryId) : undefined,
  slug: '',
  // 从 AI 选题建议点"用这个"跳过来时带着题目和难度
  title: typeof route.query.title === 'string' ? route.query.title.slice(0, 255) : '',
  difficulty: [1, 2, 3].includes(Number(route.query.difficulty)) ? Number(route.query.difficulty) : 2,
  tags: [],
  contentMd: TEMPLATE,
  sort: undefined,
  status: 'draft',
})
const path = ref('')
const savedAt = ref<string | null>(null)
const saving = ref(false)

if (!isNew.value) {
  const { data, error } = await useFetch<QuestionForm & { path: string; updatedAt: string }>(`/api/admin/questions/${route.params.id}`)
  if (error.value || !data.value) throw createError({ statusCode: 404, statusMessage: '题目不存在', fatal: true })
  const q = data.value
  Object.assign(form, {
    categoryId: q.categoryId,
    slug: q.slug,
    title: q.title,
    difficulty: q.difficulty,
    tags: q.tags,
    contentMd: q.contentMd,
    sort: q.sort,
    status: q.status,
  })
  path.value = q.path
  savedAt.value = q.updatedAt
}

useHead(() => ({ title: isNew.value ? '新建题目' : plainTitle(form.title) || '编辑题目' }))

// ---------- 未保存的修改 ----------
// 和上次保存的内容比较，改回去了就不算未保存
const snapshot = () => JSON.stringify(form)
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)

onBeforeRouteLeave(() => {
  if (dirty.value && !confirm('还有修改没有保存，确定离开吗？')) return false
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!dirty.value) return
  e.preventDefault()
  e.returnValue = ''
}

/** 页面任何位置按 Ctrl + S 都保存 */
function onKeydown(e: KeyboardEvent) {
  // 编辑区里按的已经由编辑器处理过了
  if (e.defaultPrevented) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save()
  }
}

// 每分钟刷新一次"x 分钟前保存"
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('keydown', onKeydown)
  clock = setInterval(() => (now.value = Date.now()), 30_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('keydown', onKeydown)
  clearInterval(clock)
})

const saveState = computed(() => {
  if (saving.value) return { kind: 'saving', text: '保存中…' }
  if (dirty.value) return { kind: 'dirty', text: '有未保存的修改' }
  if (savedAt.value) return { kind: 'saved', text: `已保存 · ${relativeTime(savedAt.value, now.value)}` }
  return { kind: 'new', text: '还没有保存' }
})

// ---------- 保存 ----------
const versionPanel = ref<{ reload: () => Promise<void> }>()

async function save() {
  if (saving.value) return
  if (!form.title.trim()) {
    panel.value = 'props'
    return ElMessage.warning('请填写题目')
  }
  saving.value = true
  try {
    const body = { ...form, title: form.title.trim(), slug: form.slug.trim() }
    if (isNew.value) {
      const { id, sync } = await $fetch<{ id: number; sync: { error?: string } }>('/api/admin/questions', { method: 'POST', body })
      baseline.value = snapshot()
      warnSync(sync)
      ElMessage.success('已创建')
      await navigateTo(`/admin/questions/${id}`, { replace: true })
    } else {
      const { sync } = await $fetch<{ sync: { error?: string } }>(`/api/admin/questions/${route.params.id}`, { method: 'PUT', body })
      baseline.value = snapshot()
      savedAt.value = new Date().toISOString()
      now.value = Date.now()
      warnSync(sync)
      const cat = categories.value.find((c) => c.id === form.categoryId)
      if (cat) path.value = `/${cat.partSlug}/${cat.slug}/${body.slug}`
      ElMessage.success(form.status === 'published' ? '已保存并发布' : '已保存为草稿')
      versionPanel.value?.reload()
    }
    // 目录有变化，刷新前台缓存的目录
    refreshNuxtData('outline')
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

function warnSync(sync?: { error?: string }) {
  if (sync?.error) ElMessage.warning(`已保存到数据库，但写回 content 文件失败：${sync.error}`)
}

// ---------- 属性 ----------
const categories = computed(() =>
  structure.value.flatMap((p) => p.categories.map((c) => ({ ...c, partSlug: p.slug, partTitle: p.title }))),
)
const urlPrefix = computed(() => {
  const cat = categories.value.find((c) => c.id === form.categoryId)
  return cat ? `/${cat.partSlug}/${cat.slug}/` : '/分类/'
})

// ---------- 格式检查 ----------
const { all: outlineQuestions } = useOutline()
const knownPaths = computed(() => new Set(outlineQuestions.value.map((q) => q.path)))

/** 编辑页里更好懂的说法 */
function editorMessage(message: string) {
  if (message.startsWith('一级标题后面不是')) return '正文要以"::: tip 一句话回答"开头'
  if (/^一级标题有 \d+ 个$/.test(message)) return '正文里不要再写一级标题（# ），题目会单独显示'
  return message
}

/**
 * 按 content/ 里文件的格式拼出完整的 Markdown 再检查，规则和 npm run content:check 完全一致；
 * 问题的行号换算成编辑器里的行号
 */
const lint = computed(() => {
  const front = [
    '---',
    `difficulty: ${form.difficulty}`,
    `tags: [${form.tags.join(', ')}]`,
    ...(form.status === 'draft' ? ['status: draft'] : []),
    '---',
  ].join('\n')
  const header = `${front}\n\n# ${form.title.trim() || '未命名'}\n\n`
  const offset = header.split('\n').length - 1
  const content = form.contentMd
  const leadingLines = content.slice(0, content.length - content.trimStart().length).split('\n').length - 1
  const result = lintQuestionMarkdown(`${header}${content.trim()}\n`, {
    linkExists: (p) => knownPaths.value.has(p) || p === path.value,
  })
  const map = (issue: LintIssue): LintIssue => ({
    message: editorMessage(issue.message),
    line: issue.line && issue.line > offset ? issue.line - offset + leadingLines : undefined,
  })
  return { problems: result.problems.map(map), warnings: result.warnings.map(map) }
})

const editor = ref<{ goToLine: (line: number) => void }>()

// ---------- 侧栏 ----------
type Panel = 'props' | 'lint' | 'history' | 'ai'
const initialPanel = String(route.query.panel)
const panel = ref<Panel>(
  initialPanel === 'lint' || initialPanel === 'ai' || (initialPanel === 'history' && !isNew.value) ? (initialPanel as Panel) : 'props',
)

// ---------- AI 写题 ----------
const pristine = computed(() => !form.contentMd.trim() || form.contentMd === TEMPLATE)
const lintIssues = computed(() =>
  [...lint.value.problems, ...lint.value.warnings].map((i) => (i.line ? `第 ${i.line} 行：${i.message}` : i.message)),
)
const categoryTitle = computed(() => categories.value.find((c) => c.id === form.categoryId)?.title ?? '')

function pickTopic(t: { title: string; difficulty: number }) {
  if (isNew.value) {
    form.title = t.title
    form.difficulty = t.difficulty
    ElMessage.success('已填入题目，可以接着让 AI 起草正文')
  } else {
    navigateTo({ path: '/admin/questions/new', query: { categoryId: form.categoryId, title: t.title, difficulty: t.difficulty, panel: 'ai' } })
  }
}

function restoreVersion(v: QuestionVersionDetail) {
  Object.assign(form, { title: v.title, difficulty: v.difficulty, tags: [...v.tags], status: v.status, contentMd: v.contentMd })
  ElMessage.success('已载入到编辑器，检查无误后保存即可')
}
</script>

<template>
  <div class="ws">
    <!-- 顶栏：返回、标题、保存状态、操作 -->
    <header class="ws-bar">
      <NuxtLink to="/admin/questions" class="a-icon-btn" title="返回题目列表" aria-label="返回题目列表"><AdminIcon name="back" /></NuxtLink>
      <div class="ws-title">
        <p class="eyebrow">{{ isNew ? '新建题目' : `编辑题目 · #${questionId}` }}</p>
        <p class="ws-name serif">{{ plainTitle(form.title) || '未命名题目' }}</p>
      </div>
      <span class="save-state" :class="saveState.kind" role="status">
        <i aria-hidden="true" />{{ saveState.text }}
      </span>
      <a
        v-if="path && form.status === 'published'"
        :href="path"
        target="_blank"
        rel="noopener"
        class="btn btn-sm"
        :title="dirty ? '前台显示的是上次保存的内容' : ''"
      >
        <AdminIcon name="external" :size="15" />查看页面
      </a>
      <button type="button" class="btn btn-sm btn-primary" :disabled="saving" @click="save">
        保存<kbd class="kbd">Ctrl S</kbd>
      </button>
    </header>

    <div class="ws-body">
      <section class="ws-main">
        <label class="visually-hidden" for="q-title">题目</label>
        <input
          id="q-title"
          v-model="form.title"
          class="title-input serif"
          maxlength="255"
          placeholder="题目，用问句：什么是闭包？有哪些应用场景？"
          autocomplete="off"
        />
        <AdminMarkdownEditor ref="editor" v-model="form.contentMd" class="md" @save="save" />
        <p class="hint">
          支持 <span class="a-code">::: tip 标题</span> 提示块和 <span class="a-code">::: details 问题</span> 折叠追问；题目里用反引号包代码，如 <span class="a-code">`v-model`</span>。
        </p>
      </section>

      <aside class="ws-side a-card">
        <div class="tabs" role="tablist" aria-label="题目设置">
          <button type="button" role="tab" :aria-selected="panel === 'props'" @click="panel = 'props'">属性</button>
          <button type="button" role="tab" :aria-selected="panel === 'lint'" @click="panel = 'lint'">
            检查
            <span v-if="lint.problems.length" class="badge bad">{{ lint.problems.length }}</span>
            <span v-else-if="lint.warnings.length" class="badge warn">{{ lint.warnings.length }}</span>
            <span v-else class="badge ok" aria-label="没有问题"><AdminIcon name="check" :size="12" /></span>
          </button>
          <button type="button" role="tab" :aria-selected="panel === 'history'" :disabled="isNew" @click="panel = 'history'">历史</button>
          <button type="button" role="tab" :aria-selected="panel === 'ai'" @click="panel = 'ai'"><AdminIcon name="sparkle" :size="14" />AI</button>
        </div>

        <!-- 属性 -->
        <div v-show="panel === 'props'" class="pane" role="tabpanel">
          <ElForm label-position="top" @submit.prevent="save">
            <ElFormItem label="分类">
              <ElSelect v-model="form.categoryId" placeholder="选择分类" filterable>
                <ElOptionGroup v-for="part in structure" :key="part.id" :label="part.title">
                  <ElOption v-for="cat in part.categories" :key="cat.id" :label="cat.title" :value="cat.id" />
                </ElOptionGroup>
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="网址">
              <ElInput v-model="form.slug" placeholder="closure" spellcheck="false">
                <template #prepend><span class="url-prefix" :title="urlPrefix">{{ urlPrefix }}</span></template>
              </ElInput>
              <p class="field-tip">只能用小写字母、数字和连字符；改了以后旧链接会失效</p>
            </ElFormItem>
            <ElFormItem label="难度">
              <div class="a-seg full" role="group" aria-label="难度">
                <button v-for="n in 3" :key="n" type="button" :aria-pressed="form.difficulty === n" @click="form.difficulty = n">
                  <AdminLevel :value="n" />
                </button>
              </div>
            </ElFormItem>
            <ElFormItem label="标签">
              <ElSelect v-model="form.tags" multiple filterable allow-create :multiple-limit="6" placeholder="选择或输入标签">
                <ElOption v-for="t in QUESTION_TAGS" :key="t" :label="t" :value="t" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="状态">
              <div class="a-seg full" role="group" aria-label="状态">
                <button type="button" :aria-pressed="form.status === 'draft'" @click="form.status = 'draft'">草稿</button>
                <button type="button" :aria-pressed="form.status === 'published'" @click="form.status = 'published'">发布</button>
              </div>
              <p class="field-tip">{{ form.status === 'draft' ? '草稿只在后台可见' : '保存后前台立即可见' }}</p>
            </ElFormItem>
            <ElFormItem label="排序">
              <ElInputNumber v-model="form.sort" :min="0" :step="10" controls-position="right" placeholder="排在最后" />
              <p class="field-tip">越小越靠前；留空排在分类末尾</p>
            </ElFormItem>
          </ElForm>
        </div>

        <!-- 格式检查 -->
        <div v-show="panel === 'lint'" class="pane" role="tabpanel">
          <p class="intro">和命令行 <span class="a-code">npm run content:check</span> 是同一套规则，边写边检查。点有行号的问题跳到那一行。</p>
          <div v-if="!lint.problems.length && !lint.warnings.length" class="a-alert ok">
            <AdminIcon name="check" :size="16" />格式都没问题
          </div>
          <template v-for="group in [{ key: 'problems', label: '需要修改', items: lint.problems }, { key: 'warnings', label: '建议修改', items: lint.warnings }]" :key="group.key">
            <div v-if="group.items.length" class="issues" :class="group.key">
              <h3>{{ group.label }} <span class="a-num">{{ group.items.length }}</span></h3>
              <ul>
                <li v-for="(issue, i) in group.items" :key="i">
                  <button v-if="issue.line" type="button" class="issue" @click="editor?.goToLine(issue.line)">
                    <span class="line-no a-mono">第 {{ issue.line }} 行</span>{{ issue.message }}
                  </button>
                  <span v-else class="issue">{{ issue.message }}</span>
                </li>
              </ul>
            </div>
          </template>
        </div>

        <!-- AI 写题 -->
        <div v-show="panel === 'ai'" class="pane" role="tabpanel">
          <AdminAiAssistant
            v-model:content="form.contentMd"
            :is-new="isNew"
            :question-id="isNew ? null : questionId"
            :category-id="form.categoryId"
            :category-title="categoryTitle"
            :title="form.title"
            :difficulty="form.difficulty"
            :pristine="pristine"
            :issues="lintIssues"
            @pick-topic="pickTopic"
          />
        </div>

        <!-- 修改历史 -->
        <div v-if="!isNew" v-show="panel === 'history'" class="pane" role="tabpanel">
          <AdminVersionPanel ref="versionPanel" :question-id="questionId" :current="form" @restore="restoreVersion" />
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ws {
  --bar-h: 64px;
  margin: -32px -40px -72px;
}

/* ---------- 顶栏 ---------- */
.ws-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--bar-h);
  padding: 0 24px 0 16px;
  border-bottom: 1px solid var(--c-divider);
  background: color-mix(in srgb, var(--c-bg) 88%, transparent);
  backdrop-filter: saturate(1.4) blur(10px);
}

.ws-title {
  flex: 1;
  min-width: 0;
}

.ws-title .eyebrow {
  font-size: 11px;
}

.ws-name {
  margin: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.save-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  white-space: nowrap;
  color: var(--c-text-3);
}

.save-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-text-3);
}

.save-state.saved i {
  background: var(--st-mastered);
}

.save-state.dirty {
  color: var(--c-warning);
}

.save-state.dirty i {
  background: var(--st-fuzzy);
}

.save-state.saving i {
  background: var(--c-brand);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}

.btn-primary .kbd {
  height: 18px;
  margin-left: 2px;
  border: none;
  background: color-mix(in srgb, var(--c-on-ink) 16%, transparent);
  color: inherit;
  opacity: 0.85;
}

/* ---------- 主体 ---------- */
.ws-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 20px;
  align-items: start;
  padding: 20px 24px 40px;
}

.ws-main {
  min-width: 0;
}

.title-input {
  width: 100%;
  margin: 0 0 14px;
  padding: 6px 2px;
  border: none;
  border-bottom: 1px solid transparent;
  outline: none;
  background: transparent;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--c-text-1);
}

.title-input::placeholder {
  color: var(--c-text-3);
  font-weight: 500;
}

.title-input:focus {
  border-bottom-color: var(--c-brand);
}

.md {
  --md-editor-h: calc(100vh - var(--bar-h) - 190px);
}

.hint {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--c-text-3);
}

/* ---------- 侧栏 ---------- */
.ws-side {
  position: sticky;
  top: calc(var(--bar-h) + 20px);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - var(--bar-h) - 40px);
  overflow: hidden;
}

.tabs {
  display: flex;
  flex: none;
  padding: 0 8px;
  border-bottom: 1px solid var(--c-divider);
}

.tabs button {
  position: relative;
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 44px;
  border: none;
  background: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text-2);
  cursor: pointer;
}

.tabs button:hover:not(:disabled) {
  color: var(--c-text-1);
}

.tabs button[aria-selected='true'] {
  font-weight: 600;
  color: var(--c-text-1);
}

.tabs button[aria-selected='true']::after {
  content: '';
  position: absolute;
  right: 16px;
  bottom: -1px;
  left: 16px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--c-brand);
}

.tabs button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--r-full);
  font-size: 11px;
  font-weight: 700;
}

.badge.bad {
  background: var(--st-weak);
  color: #fff;
}

.badge.warn {
  background: var(--c-warning-soft);
  color: var(--c-warning);
}

.badge.ok {
  background: var(--c-success-soft);
  color: var(--c-success);
}

.pane {
  flex: 1;
  min-height: 0;
  padding: 16px 18px 18px;
  overflow-y: auto;
}

.pane :deep(.el-form-item) {
  margin-bottom: 16px;
}

.pane :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--c-text-1);
}

.pane :deep(.el-select),
.pane :deep(.el-input-number) {
  width: 100%;
}

.url-prefix {
  display: inline-block;
  max-width: 120px;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
}

.field-tip {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-text-3);
}

.a-seg.full {
  display: flex;
  width: 100%;
}

.a-seg.full button {
  flex: 1;
}

.intro {
  margin: 0 0 14px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.issues + .issues {
  margin-top: 16px;
}

.issues h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
}

.issues.problems h3 {
  color: var(--c-danger);
}

.issues.warnings h3 {
  color: var(--c-warning);
}

.issues ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.issue {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-left: 2px solid var(--c-divider);
  background: none;
  font-size: 13px;
  line-height: 1.55;
  text-align: left;
  color: var(--c-text-1);
}

.problems .issue {
  border-left-color: var(--st-weak);
}

.warnings .issue {
  border-left-color: var(--st-fuzzy);
}

button.issue {
  cursor: pointer;
}

button.issue:hover {
  background: var(--c-default-soft);
}

.line-no {
  display: block;
  margin-bottom: 1px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

@media (max-width: 1100px) {
  .ws-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .ws-side {
    position: static;
    max-height: none;
  }
}

@media (max-width: 860px) {
  .ws {
    margin: -20px -16px -56px;
  }

  /* 窄屏时后台导航已经固定在顶部，顶栏跟着页面滚动 */
  .ws-bar {
    position: relative;
    padding: 0 12px 0 8px;
    gap: 8px;
  }

  .save-state {
    display: none;
  }

  .btn-primary .kbd {
    display: none;
  }

  .ws-body {
    padding: 16px 16px 32px;
  }

  .title-input {
    font-size: 21px;
  }

  .md {
    --md-editor-h: 70vh;
  }
}
</style>
