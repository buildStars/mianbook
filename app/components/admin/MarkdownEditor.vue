<script setup lang="ts">
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ save: [] }>()

type Mode = 'split' | 'edit' | 'preview'
const mode = ref<Mode>('split')
const MODES: { value: Mode; label: string }[] = [
  { value: 'edit', label: '编辑' },
  { value: 'split', label: '分栏' },
  { value: 'preview', label: '预览' },
]
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
onMounted(() => {
  // 手机上分栏太挤，默认只显示编辑区
  if (window.innerWidth < 900) mode.value = 'edit'
  render()
})

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

/** 跳到第 line 行并选中这一行（格式检查里点问题时用） */
function goToLine(line: number) {
  if (mode.value === 'preview') mode.value = 'split'
  nextTick(() => {
    const el = textarea.value
    if (!el) return
    const lines = model.value.split('\n')
    const n = Math.min(Math.max(1, line), lines.length)
    const start = lines.slice(0, n - 1).reduce((sum, l) => sum + l.length + 1, 0)
    const end = start + (lines[n - 1]?.length ?? 0)

    // 长行会自动折行，不能直接用行号乘行高；用一个排版相同的隐藏元素量出这一行的位置
    const cs = getComputedStyle(el)
    const mirror = document.createElement('div')
    Object.assign(mirror.style, {
      position: 'absolute',
      top: '0',
      left: '-9999px',
      visibility: 'hidden',
      boxSizing: 'border-box',
      width: `${el.clientWidth}px`,
      padding: cs.padding,
      font: cs.font,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      tabSize: cs.tabSize,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
    })
    // 末尾补一个零宽字符，空行也能量出高度
    mirror.textContent = `${model.value.slice(0, start)}​`
    document.body.appendChild(mirror)
    const top = mirror.scrollHeight - parseFloat(cs.lineHeight) - parseFloat(cs.paddingBottom)
    mirror.remove()

    el.focus({ preventScroll: true })
    el.setSelectionRange(start, end)
    el.scrollTop = Math.max(0, top - el.clientHeight / 3)
    syncScroll()
  })
}

defineExpose({ goToLine })

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
      <div class="a-seg mode" role="group" aria-label="显示方式">
        <button v-for="m in MODES" :key="m.value" type="button" :aria-pressed="mode === m.value" @click="mode = m.value">{{ m.label }}</button>
      </div>
    </div>
    <div class="panes" :class="mode">
      <textarea
        v-show="mode !== 'preview'"
        aria-label="题目正文（Markdown）"
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

.a-seg.mode {
  padding: 2px;
}

.a-seg.mode button {
  height: 24px;
  padding: 0 10px;
  font-size: 12.5px;
}

.status {
  margin-right: 8px;
  font-size: 12px;
  color: var(--c-text-3);
}

.panes {
  display: grid;
  /* 页面可以用 --md-editor-h 指定编辑区高度 */
  height: var(--md-editor-h, calc(100vh - 260px));
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
