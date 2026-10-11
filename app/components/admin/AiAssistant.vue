<script setup lang="ts">
import { cleanGeneratedMarkdown } from '#shared/utils/authoring'

/**
 * 编辑页侧栏的 AI 写题：起草正文（直接写进编辑器）、改写正文（先对比再决定是否采用）、推荐选题
 */
const props = defineProps<{
  isNew: boolean
  questionId: number | null
  categoryId: number | undefined
  categoryTitle: string
  title: string
  difficulty: number
  /** 正文还是模板或空的，起草时不用确认覆盖 */
  pristine: boolean
  /** 格式检查的问题，"第 N 行：……" */
  issues: string[]
}>()
const content = defineModel<string>('content', { required: true })
const emit = defineEmits<{ pickTopic: [topic: { title: string; difficulty: number }] }>()

interface Topic {
  difficulty: number
  title: string
  reason: string
}

const { headersFor } = useAiKey()
const busy = ref<'draft' | 'revise' | 'topics' | null>(null)
let controller: AbortController | null = null

function stop() {
  controller?.abort()
}
onBeforeUnmount(stop)

const base = computed(() => ({
  categoryId: props.categoryId,
  title: props.title.trim(),
  difficulty: props.difficulty,
  questionId: props.questionId ?? undefined,
}))
const ready = computed(() => Boolean(props.categoryId) && props.title.trim().length >= 2)

// ---------- 起草 ----------
const notes = ref('')
const drafted = ref(0)

async function draft() {
  if (!ready.value || busy.value) return
  if (!props.pristine) {
    try {
      await ElMessageBox.confirm('AI 起草会替换编辑器里现在的正文。已经保存过的内容可以在"历史"里找回。', '替换正文？', {
        confirmButtonText: '替换',
        cancelButtonText: '取消',
        type: 'warning',
      })
    } catch {
      return
    }
  }
  const backup = content.value
  let text = ''
  busy.value = 'draft'
  drafted.value = 0
  controller = new AbortController()
  try {
    await postSSE(
      '/api/admin/ai/draft',
      { ...base.value, notes: notes.value.trim() || undefined },
      { headers: headersFor(), signal: controller.signal },
      (event, data) => {
        if (event !== 'delta') return
        text += data.text
        content.value = text
        drafted.value = text.length
      },
    )
    content.value = cleanGeneratedMarkdown(text)
    ElMessage.success('草稿写好了，请逐段核对后再保存')
  } catch (error) {
    if (controller.signal.aborted) {
      if (text) content.value = cleanGeneratedMarkdown(text)
      ElMessage.info('已停止，保留了已经生成的部分')
    } else {
      if (!text) content.value = backup
      ElMessage.error(errorMessage(error))
    }
  } finally {
    busy.value = null
    controller = null
  }
}

// ---------- 改写 ----------
type Mode = 'lint' | 'feedback' | 'custom'
const mode = ref<Mode>(props.issues.length ? 'lint' : 'custom')
const instruction = ref('')
const MODES: { value: Mode; label: string }[] = [
  { value: 'lint', label: '修复检查问题' },
  { value: 'feedback', label: '参考面试反馈' },
  { value: 'custom', label: '按要求修改' },
]
const canRevise = computed(() => {
  if (!ready.value || !content.value.trim() || props.pristine) return false
  if (mode.value === 'lint') return props.issues.length > 0
  if (mode.value === 'feedback') return !props.isNew
  return instruction.value.trim().length >= 2
})

const revision = reactive({ open: false, base: '', text: '', done: false, error: '' })
const streamEl = ref<HTMLElement>()

async function revise() {
  if (!canRevise.value || busy.value) return
  Object.assign(revision, { open: true, base: content.value, text: '', done: false, error: '' })
  busy.value = 'revise'
  controller = new AbortController()
  const extra =
    mode.value === 'lint' ? { issues: props.issues } : mode.value === 'custom' ? { instruction: instruction.value.trim() } : {}
  try {
    await postSSE(
      '/api/admin/ai/revise',
      { ...base.value, mode: mode.value, contentMd: content.value, ...extra },
      { headers: headersFor(), signal: controller.signal },
      (event, data) => {
        if (event !== 'delta') return
        revision.text += data.text
        nextTick(() => streamEl.value?.scrollTo({ top: streamEl.value.scrollHeight }))
      },
    )
    revision.text = cleanGeneratedMarkdown(revision.text)
    revision.done = true
  } catch (error) {
    if (!controller.signal.aborted) revision.error = errorMessage(error)
    else revision.open = false
  } finally {
    busy.value = null
    controller = null
  }
}

function applyRevision() {
  content.value = revision.text
  revision.open = false
  ElMessage.success('已应用到编辑器，检查无误后保存')
}

// 生成过程中关掉对话框就停止生成
watch(
  () => revision.open,
  (open) => {
    if (!open && busy.value === 'revise') stop()
  },
)

// ---------- 选题 ----------
const hint = ref('')
const topics = ref<Topic[]>([])
const topicList = ref<HTMLElement>()

async function suggest() {
  if (!props.categoryId || busy.value) return
  busy.value = 'topics'
  try {
    const res = await $fetch<{ suggestions: Topic[] }>('/api/admin/ai/topics', {
      method: 'POST',
      body: { categoryId: props.categoryId, hint: hint.value.trim() || undefined },
      headers: headersFor(),
    })
    topics.value = res.suggestions
    // 侧栏比较长，结果出来后滚到能看见的位置
    nextTick(() => topicList.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="assistant">
    <p class="intro">
      AI 写的内容可能有错，尤其是版本号、API 和数字，发布前请逐段核对。使用站点的 Key（或你在前台 AI 设置里填的 Key），不占每日次数。
    </p>

    <!-- 起草 -->
    <section class="block">
      <h3>起草正文</h3>
      <p class="desc">按写作规范、参考同分类的一道题，写一篇完整正文，直接写进编辑器。</p>
      <ElInput v-model="notes" type="textarea" :rows="3" resize="none" maxlength="2000" placeholder="可选：希望覆盖的要点、想强调的对比……" />
      <div class="row">
        <button v-if="busy === 'draft'" type="button" class="btn btn-sm" @click="stop">
          <AdminIcon name="close" :size="15" />停止
        </button>
        <button v-else type="button" class="btn btn-sm btn-primary" :disabled="!ready || !!busy" @click="draft">
          <AdminIcon name="sparkle" :size="15" />AI 起草正文
        </button>
        <span v-if="busy === 'draft'" class="status"><i class="spin" aria-hidden="true" />已写 {{ drafted }} 字</span>
        <span v-else-if="!ready" class="status">先填写题目，并在"属性"里选分类</span>
      </div>
    </section>

    <!-- 改写 -->
    <section class="block">
      <h3>修改正文</h3>
      <div class="a-seg full" role="group" aria-label="修改方式">
        <button v-for="m in MODES" :key="m.value" type="button" :aria-pressed="mode === m.value" @click="mode = m.value">{{ m.label }}</button>
      </div>
      <p v-if="mode === 'lint'" class="desc">
        {{ issues.length ? `把格式检查发现的 ${issues.length} 个问题交给 AI 修复，其余内容不动。` : '格式检查没有发现问题。' }}
      </p>
      <p v-else-if="mode === 'feedback'" class="desc">
        {{ isNew ? '保存后才能用：' : '' }}汇总这道题最近 20 次 AI 面试指出的遗漏，补上题解没讲清楚的地方。只发送 AI 的点评，不发送用户的回答。
      </p>
      <template v-else>
        <p class="desc">写下要怎么改，例如"补充 Vue 3 和 Vue 2 的区别"、"代码示例改成 TypeScript"。</p>
        <ElInput v-model="instruction" type="textarea" :rows="3" resize="none" maxlength="2000" placeholder="修改要求" />
      </template>
      <div class="row">
        <button type="button" class="btn btn-sm" :disabled="!canRevise || !!busy" @click="revise">
          <AdminIcon name="edit" :size="15" />生成修改稿
        </button>
        <span class="status">生成后先对比，再决定是否采用</span>
      </div>
    </section>

    <!-- 选题 -->
    <section class="block">
      <h3>选题建议</h3>
      <p class="desc">{{ categoryId ? `看看"${categoryTitle}"还缺哪些高频题。` : '先在"属性"里选分类。' }}</p>
      <ElInput v-model="hint" maxlength="500" placeholder="可选：想补充的方向，例如性能优化、工程实践" />
      <div class="row">
        <button type="button" class="btn btn-sm" :disabled="!categoryId || !!busy" @click="suggest">
          <AdminIcon name="sparkle" :size="15" />{{ busy === 'topics' ? '思考中…' : '推荐题目' }}
        </button>
      </div>
      <ul v-if="topics.length" ref="topicList" class="topics">
        <li v-for="t in topics" :key="t.title">
          <div class="topic-main">
            <RichTitle :title="t.title" class="topic-title" />
            <p class="topic-reason"><AdminLevel :value="t.difficulty" /><span>{{ t.reason }}</span></p>
          </div>
          <button type="button" class="btn btn-sm btn-ghost use" @click="emit('pickTopic', { title: t.title, difficulty: t.difficulty })">用这个</button>
        </li>
      </ul>
    </section>

    <ElDialog v-model="revision.open" width="min(920px, 94vw)" top="6vh" append-to-body class="revision-dialog">
      <template #header>
        <div>
          <p class="eyebrow">AI 修改稿</p>
          <h2 class="dlg-title serif">{{ revision.done ? '对比：编辑器里的内容 → 修改稿' : revision.error ? '生成失败' : 'AI 正在修改…' }}</h2>
        </div>
      </template>
      <div v-if="revision.error" class="a-alert bad"><AdminIcon name="alert" :size="16" />{{ revision.error }}</div>
      <AdminDiffView v-else-if="revision.done" :old-text="revision.base" :new-text="revision.text" class="dlg-diff" />
      <pre v-else ref="streamEl" class="stream">{{ revision.text || '等待 AI 输出…' }}</pre>
      <template #footer>
        <span class="foot-tip">{{ revision.done ? '应用后不会自动保存' : '' }}</span>
        <ElButton @click="revision.open = false">{{ revision.done || revision.error ? '放弃' : '停止' }}</ElButton>
        <ElButton type="primary" :disabled="!revision.done" @click="applyRevision">应用到编辑器</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.intro {
  margin: 0 0 4px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--c-warning-soft);
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--c-warning);
}

.block {
  padding: 16px 0;
}

.block + .block {
  border-top: 1px solid var(--c-divider);
}

.block h3 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
}

.desc {
  margin: 0 0 10px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.a-seg.full {
  display: flex;
  width: 100%;
  margin: 6px 0 10px;
}

.a-seg.full button {
  flex: 1;
  padding: 0 6px;
  font-size: 12.5px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  margin-top: 10px;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--c-text-3);
}

.spin {
  width: 12px;
  height: 12px;
  border: 2px solid var(--c-divider);
  border-top-color: var(--c-brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.topics {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.topics li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 0;
  border-top: 1px dashed var(--c-divider);
}

.topic-main {
  flex: 1;
  min-width: 0;
}

.topic-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.5;
}

.topic-reason {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-text-3);
}

.topic-reason :deep(.a-level) {
  flex: none;
  font-size: 12px;
}

.use {
  flex: none;
  color: var(--c-brand);
}

.dlg-title {
  margin: 4px 0 0;
  font-size: 19px;
}

.stream {
  max-height: 60vh;
  margin: 0;
  padding: 14px 16px;
  overflow: auto;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  color: var(--c-text-2);
}

.dlg-diff :deep(.diff-body) {
  max-height: 58vh;
}

.foot-tip {
  margin-right: auto;
  font-size: 12.5px;
  color: var(--c-text-3);
}

:global(.revision-dialog .el-dialog__footer) {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
