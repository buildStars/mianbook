<script setup lang="ts">
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ save: [] }>()

type Mode = 'split' | 'edit' | 'preview'
const mode = ref<Mode>('split')
const html = ref('')
const rendering = ref(false)
const textarea = ref<HTMLTextAreaElement>()
const previewEl = ref<HTMLElement>()

let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0

/** 预览走服务端，和正式发布用同一套渲染流程（代码高亮、提示块、追问折叠） */
async function render() {
  const current = ++seq
  rendering.value = true
  try {
    const result = await $fetch<{ html: string }>('/api/admin/preview', {
      method: 'POST',
      body: { markdown: model.value },
    })
    if (current === seq) html.value = result.html
  } finally {
    if (current === seq) rendering.value = false
  }
}

watch(model, () => {
  clearTimeout(timer)
  timer = setTimeout(render, 400)
})
onMounted(render)

/** 在光标处插入内容；选中了文字时包裹选区 */
function insert(before: string, after = '', placeholder = '') {
  const el = textarea.value
  if (!el) return
  const { selectionStart: start, selectionEnd: end, value } = el
  const selected = value.slice(start, end) || placeholder
  model.value = value.slice(0, start) + before + selected + after + value.slice(end)
  nextTick(() => {
    el.focus()
    el.setSelectionRange(start + before.length, start + before.length + selected.length)
  })
}

const block = (text: string) => {
  const el = textarea.value
  const atLineStart = !el || el.selectionStart === 0 || el.value[el.selectionStart - 1] === '\n'
  insert(`${atLineStart ? '' : '\n'}${text}`)
}

const tools = [
  { label: 'B', title: '加粗', run: () => insert('**', '**', '加粗文字') },
  { label: '`', title: '行内代码', run: () => insert('`', '`', 'code') },
  { label: 'H2', title: '二级标题', run: () => block('## ') },
  { label: 'H3', title: '三级标题', run: () => block('### ') },
  { label: '列表', title: '列表', run: () => block('- ') },
  { label: '代码块', title: '代码块', run: () => insert('\n```js\n', '\n```\n', '// 代码') },
  { label: '提示', title: '提示块', run: () => insert('\n::: tip 标题\n', '\n:::\n', '内容') },
  { label: '追问', title: '折叠的追问', run: () => insert('\n::: details 追问的问题？\n', '\n:::\n', '答案') },
  { label: '表格', title: '表格', run: () => block('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n') },
  { label: '链接', title: '链接', run: () => insert('[', '](/basics/javascript/01-event-loop)', '链接文字') },
]

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault()
    insert('  ')
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    emit('save')
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    insert('**', '**', '加粗文字')
  }
}

/** 编辑区滚动时，预览区按比例跟随 */
function syncScroll() {
  const src = textarea.value
  const dst = previewEl.value
  if (!src || !dst || mode.value !== 'split') return
  const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight)
  dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight)
}
</script>

<template>
  <div class="md-editor">
    <div class="toolbar">
      <button v-for="t in tools" :key="t.label" type="button" :title="t.title" @click="t.run">{{ t.label }}</button>
      <span class="spacer" />
      <span v-if="rendering" class="status">渲染中…</span>
      <ElRadioGroup v-model="mode" size="small">
        <ElRadioButton value="edit">编辑</ElRadioButton>
        <ElRadioButton value="split">分栏</ElRadioButton>
        <ElRadioButton value="preview">预览</ElRadioButton>
      </ElRadioGroup>
    </div>
    <div class="panes" :class="mode">
      <textarea
        v-show="mode !== 'preview'"
        ref="textarea"
        v-model="model"
        spellcheck="false"
        placeholder="在这里写 Markdown……"
        @keydown="onKeydown"
        @scroll="syncScroll"
      />
      <!-- 预览来自服务端渲染，原始 HTML 已被转义 -->
      <div v-show="mode !== 'edit'" ref="previewEl" class="preview doc-content" v-html="html" />
    </div>
  </div>
</template>

<style scoped>
.md-editor {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--c-divider);
  border-radius: 10px;
  background: var(--c-bg);
  overflow: hidden;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
}

.toolbar > button {
  min-width: 32px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  font-size: 13px;
  color: var(--c-text-2);
  cursor: pointer;
}

.toolbar > button:hover {
  border-color: var(--c-divider);
  background: var(--c-bg);
  color: var(--c-text-1);
}

.spacer {
  flex: 1;
}

.status {
  margin-right: 8px;
  font-size: 12px;
  color: var(--c-text-3);
}

.panes {
  display: grid;
  height: calc(100vh - 260px);
  min-height: 420px;
}

.panes.split {
  grid-template-columns: 1fr 1fr;
}

textarea {
  width: 100%;
  height: 100%;
  padding: 16px 18px;
  border: none;
  border-right: 1px solid var(--c-divider);
  outline: none;
  background: var(--c-bg);
  color: var(--c-text-1);
  font-family: var(--font-mono);
  font-size: 13.5px;
  line-height: 1.75;
  resize: none;
  tab-size: 2;
}

.preview {
  height: 100%;
  padding: 16px 24px 48px;
  overflow-y: auto;
}

@media (max-width: 900px) {
  .panes.split {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 1fr;
  }

  textarea {
    border-right: none;
    border-bottom: 1px solid var(--c-divider);
  }
}
</style>
