<script setup lang="ts">
/**
 * 题目正文里一个代码块的"运行"：代码块头部加上"编辑""运行"按钮，下面显示输出，代码往页面上放了东西时再显示页面预览。
 * 由 QuestionBody 挂到服务端渲染好的代码块里（不是模板里的子组件）。
 * 代码在沙箱 iframe（/sandbox/runner）里执行：独立的源、不能联网；每次运行开新的 iframe，删掉它就停掉了全部定时器
 */
const props = defineProps<{
  block: HTMLElement
  /** 同一道题前面可运行代码块的当前代码（改过的用改过的） */
  prelude: () => string[]
  register: (get: () => string) => void
}>()

const head = props.block.querySelector<HTMLElement>('.code-head')!
const pre = props.block.querySelector<HTMLElement>('pre')!
const original = pre.textContent ?? ''
const code = ref(original)
props.register(() => code.value)

const editing = ref(false)
const modified = computed(() => code.value !== original)
const textarea = ref<HTMLTextAreaElement | null>(null)

/** result 是注释里写了结果的表达式的返回值，见 shared/utils/code-prep.ts */
type Level = 'log' | 'info' | 'warn' | 'error' | 'result'
type Status = 'idle' | 'running' | 'done' | 'error' | 'stopped' | 'timeout'
const lines = ref<{ level: Level; text: string; at?: string }[]>([])
const status = ref<Status>('idle')
const elapsed = ref(0)
const preludeCount = ref(0)
const onlyDeclarations = ref(false)
const preview = ref(false)
const previewHeight = ref(0)
const frameBox = ref<HTMLElement | null>(null)

const TIMEOUT = 10_000
let frame: HTMLIFrameElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0
let source = ''
let blockStartLine = 1
let started = 0
let hadError = false

const statusText = computed(() => {
  if (status.value === 'running') return '运行中…'
  if (status.value === 'stopped') return '已停止'
  if (status.value === 'timeout') return `超过 ${TIMEOUT / 1000} 秒，已自动停止`
  if (status.value === 'error') return '出错了'
  return `完成 · ${elapsed.value < 1000 ? `${elapsed.value} 毫秒` : `${(elapsed.value / 1000).toFixed(1)} 秒`}`
})

/** 沙箱带来的限制，报错后面补一句说明 */
function explain(text: string) {
  if (text.startsWith('SecurityError')) return `${text}（运行环境是隔离的沙箱，访问嵌套 iframe 这类跨页面的操作会被浏览器拦下）`
  if (/Failed to fetch|NetworkError|Content Security Policy/.test(text)) return `${text}（运行环境不能联网）`
  if (/^ReferenceError: (fs|require|process|module|Buffer|__dirname|__filename) is not defined/.test(text)) {
    return `${text}（这是 Node.js 的写法，浏览器里没有 fs、require、process 这些）`
  }
  return text
}

const emptyText = computed(() => {
  if (preview.value) return '没有打印输出，页面效果看下面的预览'
  if (onlyDeclarations.value && status.value === 'done') return '这段只定义了函数和变量，没有输出。运行后面的代码块时会自动带上这里的定义'
  return '没有输出'
})

function push(level: Level, text: string, at?: string) {
  lines.value.push({ level, text: level === 'error' ? explain(text) : text, at })
}

/** 运行页报的是整段代码里的行号，换算成这个代码块里的行号；在前面带上的定义里出错的单独说明 */
function where(line: number | null | undefined) {
  if (!line) return undefined
  const n = line - blockStartLine + 1
  return n >= 1 ? `第 ${n} 行` : '前面代码块的定义里'
}

function teardown() {
  clearTimeout(timer)
  window.removeEventListener('message', onMessage)
  frame?.remove()
  frame = null
  preview.value = false
}

function onMessage(e: MessageEvent) {
  if (!frame || e.source !== frame.contentWindow || e.data?.source !== 'mianbook-runner') return
  const { type, data, runId } = e.data
  if (type === 'ready') {
    started = performance.now()
    frame.contentWindow!.postMessage({ type: 'run', runId: seq, code: source }, '*')
    return
  }
  if (runId !== seq) return
  if (type === 'log') push(data.level, data.text)
  else if (type === 'clear') lines.value = []
  else if (type === 'error') {
    hadError = true
    push('error', data.message, where(data.line))
  } else if (type === 'idle') finish(data.dom)
  else if (type === 'resize') previewHeight.value = Math.min(Math.max(data.height, 48), 600)
}

function finish(dom: { height: number } | null) {
  if (status.value !== 'running') return
  clearTimeout(timer)
  elapsed.value = Math.round(performance.now() - started)
  status.value = hadError ? 'error' : 'done'
  // 有页面预览时留着 iframe（里面的按钮还能点），没有就直接删掉
  if (dom) {
    preview.value = true
    previewHeight.value = Math.min(Math.max(dom.height, 48), 600)
  } else teardown()
}

async function run() {
  teardown()
  const id = ++seq
  lines.value = []
  hadError = false
  preludeCount.value = 0
  onlyDeclarations.value = false
  status.value = 'running'
  const { prepareRun } = await import('#shared/utils/code-prep')
  if (id !== seq) return
  const prepared = prepareRun(code.value, props.prelude())
  if (!prepared.ok) {
    push('error', prepared.message, prepared.line ? `第 ${prepared.line} 行` : undefined)
    // 题目原文就跑不起来的，多半是对比写法或者片段（比如同一个变量声明两次来对比对错）
    if (!modified.value && prepared.message.startsWith('语法错误')) {
      push('info', '这段是示意代码，不是能直接运行的完整程序。可以点"编辑"改成能运行的版本再试')
    }
    status.value = 'error'
    return
  }
  source = prepared.source
  blockStartLine = prepared.blockStartLine
  preludeCount.value = prepared.preludeCount
  onlyDeclarations.value = prepared.onlyDeclarations

  frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('title', '代码运行结果的页面预览')
  frame.className = 'code-frame'
  frame.src = '/sandbox/runner'
  window.addEventListener('message', onMessage)
  await nextTick()
  frameBox.value?.appendChild(frame)
  timer = setTimeout(() => {
    if (status.value !== 'running') return
    teardown()
    status.value = 'timeout'
  }, TIMEOUT)
}

function stop() {
  teardown()
  if (status.value === 'running') status.value = 'stopped'
}

function close() {
  stop()
  status.value = 'idle'
  lines.value = []
}

function autosize() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + 2}px`
}

async function edit() {
  editing.value = true
  pre.style.display = 'none'
  await nextTick()
  autosize()
  textarea.value?.focus()
}

function reset() {
  code.value = original
  editing.value = false
  pre.style.display = ''
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    run()
  }
}

onBeforeUnmount(() => {
  teardown()
  pre.style.display = ''
})
</script>

<template>
  <Teleport :to="head">
    <button v-if="!editing" type="button" class="code-tool" @click="edit">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16zM13.5 6.5l4 4" /></svg>
      编辑
    </button>
    <button v-else type="button" class="code-tool" @click="reset">{{ modified ? '还原' : '退出编辑' }}</button>
    <button
      type="button"
      class="code-tool code-run"
      :class="{ running: status === 'running' }"
      :title="status === 'running' ? '停止运行' : '在浏览器里运行这段代码'"
      @click="status === 'running' ? stop() : run()"
    >
      <svg v-if="status === 'running'" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
      <svg v-else viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" /></svg>
      {{ status === 'running' ? '停止' : '运行' }}
    </button>
  </Teleport>

  <div v-if="editing" class="code-edit">
    <textarea
      ref="textarea"
      v-model="code"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      wrap="off"
      aria-label="编辑代码"
      @input="autosize"
      @keydown="onKeydown"
    />
    <p class="code-edit-hint"><span class="kbd-hint">Ctrl + Enter 运行 · </span>改动只在这个页面里有效，刷新后恢复原样</p>
  </div>

  <div v-if="status !== 'idle'" class="code-output">
    <div class="out-head">
      <span class="out-title">输出</span>
      <span class="out-status" :class="status">{{ statusText }}</span>
      <button type="button" class="out-close" aria-label="关闭输出" @click="close">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
    <p v-if="preludeCount" class="out-note">已带上前面 {{ preludeCount }} 段代码里定义的函数和变量</p>
    <ol class="out-lines" role="log" aria-live="polite">
      <li v-for="(l, i) in lines" :key="i" :class="l.level">
        <span v-if="l.level === 'result'" class="out-arrow" aria-label="返回值">←</span>
        <span class="out-text">{{ l.text }}</span><span v-if="l.at" class="out-at">{{ l.at }}</span>
      </li>
      <li v-if="!lines.length && status !== 'running'" class="out-empty">
        {{ emptyText }}
      </li>
    </ol>
    <p v-if="preview" class="out-preview-title">页面预览</p>
    <div ref="frameBox" class="frame-box" :class="{ show: preview }" :style="preview ? { height: `${previewHeight}px` } : undefined" />
  </div>
</template>

<style scoped>
.code-tool {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  font-size: 12px;
  color: var(--code-muted);
  cursor: pointer;
  transition:
    color var(--dur-fast),
    background-color var(--dur-fast),
    border-color var(--dur-fast);
}

.code-tool:hover {
  border-color: var(--code-border);
  background: rgba(255, 255, 255, 0.05);
  color: var(--code-text);
}

.code-run {
  border-color: rgba(61, 207, 142, 0.35);
  background: rgba(61, 207, 142, 0.12);
  font-weight: 600;
  color: #3dcf8e;
}

.code-run:hover {
  border-color: rgba(61, 207, 142, 0.6);
  background: rgba(61, 207, 142, 0.2);
  color: #5fe0a6;
}

.code-run.running {
  border-color: rgba(255, 123, 114, 0.4);
  background: rgba(255, 123, 114, 0.12);
  color: #ff7b72;
}

.code-edit textarea {
  display: block;
  width: 100%;
  min-height: 120px;
  margin: 0;
  padding: 18px 20px;
  border: none;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--code-text);
  caret-color: #fff;
  white-space: pre;
  overflow-x: auto;
  resize: none;
  tab-size: 2;
  font-variant-ligatures: none;
  outline: none;
}

.code-edit textarea:focus-visible {
  box-shadow: inset 0 0 0 2px var(--c-brand-solid);
}

.code-edit-hint {
  margin: 0;
  padding: 0 20px 12px;
  font-size: 12px;
  color: var(--code-muted);
}

.code-output {
  border-top: 1px solid var(--code-border);
  background: #121318;
}

.out-head {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 8px 0 16px;
  font-size: 12px;
}

.out-title {
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
  color: var(--code-muted);
}

.out-status {
  color: var(--code-muted);
}

.out-status.running {
  color: #79c0ff;
}

.out-status.done {
  color: #3dcf8e;
}

.out-status.error,
.out-status.timeout {
  color: #ff7b72;
}

.out-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-left: auto;
  border: none;
  border-radius: var(--r-sm);
  background: none;
  color: var(--code-muted);
  cursor: pointer;
}

.out-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--code-text);
}

.out-note {
  margin: 0;
  padding: 0 16px 4px;
  font-size: 12px;
  color: var(--code-muted);
}

.out-lines {
  max-height: 360px;
  margin: 0;
  padding: 4px 0 12px;
  overflow: auto;
  list-style: none;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
}

/* 输出放在正文 .doc-content 里，正文列表的间距和序号都要去掉 */
.out-lines li {
  display: flex;
  gap: 10px;
  margin: 0;
  padding: 1px 16px;
  color: var(--code-text);
}

.out-lines li + li {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.out-text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.out-lines .info {
  color: #79c0ff;
}

.out-arrow {
  flex: none;
  color: var(--code-muted);
}

.out-lines .warn {
  background: rgba(227, 179, 65, 0.07);
  color: #e3b341;
}

.out-lines .error {
  background: rgba(255, 123, 114, 0.08);
  color: #ff7b72;
}

.out-at {
  flex: none;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--code-muted);
}

.out-empty {
  color: var(--code-muted) !important;
}

.out-preview-title {
  margin: 0;
  padding: 10px 16px 6px;
  border-top: 1px solid var(--code-border);
  font-size: 12px;
  color: var(--code-muted);
}

/* 没有页面预览时 iframe 放在屏幕外（不能 display: none，否则里面的代码量不到元素尺寸） */
.frame-box {
  position: fixed;
  top: 0;
  left: -10000px;
  width: 640px;
  height: 320px;
  visibility: hidden;
  pointer-events: none;
}

/* 页面预览深浅色模式都是白底，像一个独立的网页 */
.frame-box.show {
  position: static;
  width: auto;
  margin: 0 12px 12px;
  overflow: hidden;
  border-radius: var(--r-md);
  background: #fff;
  visibility: visible;
  pointer-events: auto;
}

.frame-box :deep(.code-frame) {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

@media (pointer: coarse) {
  .code-tool {
    height: 32px;
  }
}
</style>
