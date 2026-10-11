<script setup lang="ts">
defineProps<{ html: string }>()

/** 正文是服务端渲染的 HTML，这里用事件委托处理复制按钮和站内链接 */
async function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement

  const copy = target.closest<HTMLButtonElement>('.code-copy')
  if (copy) {
    const code = copy.closest('.code-block')?.querySelector('pre')?.textContent ?? ''
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
</script>

<template>
  <!-- 内容来自管理员编辑的 Markdown，渲染时已关闭原始 HTML，可以安全输出 -->
  <div class="doc-content" @click="onClick" v-html="html" />
</template>
