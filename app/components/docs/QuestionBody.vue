<script setup lang="ts">
import { h, render } from 'vue'
import CodeRunner from './CodeRunner.vue'

const props = defineProps<{
  html: string
  /** 代码块可以在浏览器里运行（手写题），见 app/utils/code-run.ts */
  runnable?: boolean
  /** 运行代码时记一条学习事件 */
  questionId?: number
}>()

const root = ref<HTMLElement | null>(null)
const nuxtApp = useNuxtApp()
const { track } = useLearningEvents()

/** 正文是服务端渲染的 HTML，这里用事件委托处理复制按钮和站内链接 */
async function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement

  const copy = target.closest<HTMLButtonElement>('.code-copy')
  if (copy) {
    // 正在编辑的代码块复制改过的代码
    const block = copy.closest('.code-block')
    const code = block?.querySelector('textarea')?.value ?? block?.querySelector('pre')?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(code)
      copy.classList.add('copied')
      copy.textContent = '已复制'
      setTimeout(() => {
        copy.classList.remove('copied')
        copy.textContent = '复制'
      }, 2000)
    } catch {
      // 剪贴板不可用（如非 HTTPS 环境），忽略
    }
    return
  }

  // 站内链接走前端路由，不整页刷新
  const link = target.closest<HTMLAnchorElement>('a[href^="/"]')
  if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
    event.preventDefault()
    navigateTo(link.getAttribute('href')!)
  }
}

// 可运行的代码块：在服务端渲染好的代码块里挂上 CodeRunner（加按钮、显示输出）。换题时正文整个换掉，重新挂
let hosts: HTMLElement[] = []

function unmountRunners() {
  for (const host of hosts) render(null, host)
  hosts = []
}

function mountRunners() {
  unmountRunners()
  if (!props.runnable || !root.value) return
  const blocks = [...root.value.querySelectorAll<HTMLElement>('.code-block')].filter((b) => RUNNABLE_LANGS.has(b.dataset.lang ?? ''))
  const current = new Map<HTMLElement, () => string>()
  blocks.forEach((block, i) => {
    const host = document.createElement('div')
    host.className = 'code-runner'
    block.appendChild(host)
    const vnode = h(CodeRunner, {
      block,
      register: (get: () => string) => current.set(block, get),
      onRun: () => props.questionId && track({ type: 'code_run', questionId: props.questionId }),
      prelude: () => blocks.slice(0, i).map((b) => current.get(b)?.() ?? b.querySelector('pre')?.textContent ?? ''),
    })
    vnode.appContext = nuxtApp.vueApp._context
    render(vnode, host)
    hosts.push(host)
  })
}

onMounted(mountRunners)
watch(() => [props.html, props.runnable], mountRunners, { flush: 'post' })
onBeforeUnmount(unmountRunners)
</script>

<template>
  <!-- 内容来自管理员编辑的 Markdown，渲染时已关闭原始 HTML，可以安全输出 -->
  <div ref="root" class="doc-content" @click="onClick" v-html="html" />
</template>
