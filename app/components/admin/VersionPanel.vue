<script setup lang="ts">
import type { QuestionVersionDetail, QuestionVersionSummary } from '#shared/types/admin'

/**
 * 题目的修改历史：点一个版本，和编辑器里现在的内容对比；可以把这个版本载入编辑器，检查后再保存
 */
const props = defineProps<{
  questionId: number
  /** 编辑器里现在的内容，用来对比 */
  current: { title: string; difficulty: number; tags: string[]; status: 'draft' | 'published'; contentMd: string }
}>()
const emit = defineEmits<{ restore: [version: QuestionVersionDetail] }>()

const versions = ref<QuestionVersionSummary[]>([])
const loading = ref(false)
const loaded = ref(false)

async function load() {
  loading.value = true
  try {
    versions.value = await $fetch<QuestionVersionSummary[]>(`/api/admin/questions/${props.questionId}/versions`)
    loaded.value = true
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}
onMounted(load)
defineExpose({ reload: load })

// ---------- 对比 ----------
const viewing = ref<QuestionVersionDetail | null>(null)
const open = ref(false)
const opening = ref<number | null>(null)

async function view(v: QuestionVersionSummary) {
  opening.value = v.id
  try {
    viewing.value = await $fetch<QuestionVersionDetail>(`/api/admin/questions/${props.questionId}/versions/${v.id}`)
    open.value = true
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    opening.value = null
  }
}

/** 标题、难度、标签、状态的变化 */
const metaChanges = computed(() => {
  const v = viewing.value
  if (!v) return []
  const c = props.current
  const rows: { label: string; from: string; to: string }[] = []
  if (v.title !== c.title) rows.push({ label: '题目', from: v.title, to: c.title })
  if (v.difficulty !== c.difficulty) rows.push({ label: '难度', from: DIFFICULTY_LABELS[v.difficulty] ?? '', to: DIFFICULTY_LABELS[c.difficulty] ?? '' })
  if (v.tags.join('、') !== c.tags.join('、')) rows.push({ label: '标签', from: v.tags.join('、') || '无', to: c.tags.join('、') || '无' })
  if (v.status !== c.status) {
    const s = (x: string) => (x === 'published' ? '已发布' : '草稿')
    rows.push({ label: '状态', from: s(v.status), to: s(c.status) })
  }
  return rows
})

function restore() {
  if (!viewing.value) return
  emit('restore', viewing.value)
  open.value = false
}

const editorName = (v: { editor: string | null }) => v.editor ?? '外部修改'
</script>

<template>
  <div class="versions">
    <p class="intro">每次保存记一个版本，最多保留 50 个。命令行导入等外部修改，会在下次保存前补记下来。</p>

    <p v-if="loading && !loaded" class="a-empty">加载中…</p>
    <p v-else-if="loaded && !versions.length" class="a-empty">还没有历史版本，保存后开始记录</p>

    <ol v-else class="timeline">
      <li v-for="v in versions" :key="v.id">
        <button type="button" class="item" :disabled="opening === v.id" @click="view(v)">
          <span class="dot" :class="{ now: v.current }" aria-hidden="true" />
          <span class="when">
            <time :datetime="v.createdAt" :title="formatDateTime(v.createdAt)">{{ relativeTime(v.createdAt) }}</time>
            <span v-if="v.current" class="now-tag">当前</span>
          </span>
          <span class="who">{{ editorName(v) }}<template v-if="v.status === 'draft'"> · 草稿</template></span>
          <span v-if="v.added === 0 && v.removed === 0" class="delta first">只改属性</span>
          <span v-else-if="v.added !== null" class="delta">
            <span class="add">+{{ v.added }}</span>
            <span class="del">−{{ v.removed }}</span>
          </span>
          <span v-else class="delta first">最早</span>
        </button>
      </li>
    </ol>

    <ElDialog v-model="open" width="min(920px, 94vw)" append-to-body class="version-dialog" top="6vh">
      <template #header>
        <div v-if="viewing" class="dlg-head">
          <p class="eyebrow">版本对比</p>
          <h2 class="serif">{{ formatDateTime(viewing.createdAt) }} 的版本 → 编辑器里的内容</h2>
          <p class="dlg-sub">保存者：{{ editorName(viewing) }}</p>
        </div>
      </template>
      <template v-if="viewing">
        <table v-if="metaChanges.length" class="meta">
          <tbody>
            <tr v-for="m in metaChanges" :key="m.label">
              <th>{{ m.label }}</th>
              <td class="from">{{ m.from }}</td>
              <td class="arrow" aria-hidden="true">→</td>
              <td class="to">{{ m.to }}</td>
            </tr>
          </tbody>
        </table>
        <AdminDiffView :old-text="viewing.contentMd" :new-text="current.contentMd" class="dlg-diff" />
      </template>
      <template #footer>
        <span class="foot-tip">载入后不会自动保存，检查无误再点保存</span>
        <ElButton @click="open = false">关闭</ElButton>
        <ElButton type="primary" @click="restore"><AdminIcon name="restore" :size="15" />&nbsp;载入这个版本</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.intro {
  margin: 0 0 14px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.timeline {
  position: relative;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 竖线把各个版本串起来 */
.timeline::before {
  content: '';
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 13px;
  width: 1px;
  background: var(--c-divider);
}

.item {
  position: relative;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 0 8px;
  width: 100%;
  padding: 8px 8px 8px 9px;
  border: none;
  border-radius: var(--r-sm);
  background: none;
  text-align: left;
  cursor: pointer;
}

.item:hover {
  background: var(--c-default-soft);
}

.item:disabled {
  cursor: progress;
}

.dot {
  grid-row: span 2;
  width: 9px;
  height: 9px;
  margin-top: 6px;
  border: 2px solid var(--c-text-3);
  border-radius: 50%;
  background: var(--c-bg-elv);
}

.dot.now {
  border-color: var(--c-brand);
  background: var(--c-brand);
}

.when {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 600;
}

.now-tag {
  padding: 0 6px;
  border-radius: var(--r-xs);
  background: var(--c-brand-soft);
  font-size: 11px;
  line-height: 18px;
  color: var(--c-brand);
}

.who {
  grid-column: 2;
  font-size: 12px;
  color: var(--c-text-3);
}

.delta {
  grid-row: 1 / span 2;
  grid-column: 3;
  align-self: center;
  display: flex;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
}

.delta .add {
  color: var(--c-success);
}

.delta .del {
  color: var(--c-danger);
}

.delta.first {
  font-family: var(--font-sans);
  color: var(--c-text-3);
}

.dlg-head h2 {
  margin: 4px 0 0;
  font-size: 19px;
}

.dlg-sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--c-text-3);
}

.meta {
  width: 100%;
  margin-bottom: 14px;
  border-collapse: collapse;
  font-size: 13.5px;
}

.meta th,
.meta td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--c-divider);
  text-align: left;
  vertical-align: top;
}

.meta th {
  width: 56px;
  font-weight: 500;
  color: var(--c-text-3);
}

.meta .from {
  color: var(--c-danger);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--c-danger) 40%, transparent);
}

.meta .arrow {
  width: 20px;
  color: var(--c-text-3);
}

.meta .to {
  color: var(--c-success);
}

.dlg-diff :deep(.diff-body) {
  max-height: 58vh;
}

.foot-tip {
  margin-right: auto;
  font-size: 12.5px;
  color: var(--c-text-3);
}

:global(.version-dialog .el-dialog__footer) {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
