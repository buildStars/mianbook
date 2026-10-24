import type { Ref } from 'vue'

/**
 * 头部下拉面板（题库、我的）的开关：点按钮切换，点面板外面、按 Esc、换页时关闭；Esc 关闭后焦点回到按钮。
 * hover 为 true 时鼠标停留一小会儿也会打开、移走后关闭（只对鼠标，触屏仍然靠点）
 */
export function usePopover(root: Ref<HTMLElement | null>, options: { hover?: boolean } = {}) {
  const open = ref(false)
  const route = useRoute()
  let timer: ReturnType<typeof setTimeout> | undefined
  // 鼠标悬停刚打开时用户往往会顺手点一下按钮，这时不要又把它关掉
  let hoverOpenedAt = 0

  watch(
    () => route.fullPath,
    () => (open.value = false),
  )

  function toggle() {
    clearTimeout(timer)
    if (open.value && Date.now() - hoverOpenedAt < 600) return
    open.value = !open.value
  }

  function close() {
    clearTimeout(timer)
    open.value = false
  }

  function onPointerEnter(e: PointerEvent) {
    if (!options.hover || e.pointerType !== 'mouse') return
    clearTimeout(timer)
    if (open.value) return
    timer = setTimeout(() => {
      open.value = true
      hoverOpenedAt = Date.now()
    }, 140)
  }

  function onPointerLeave(e: PointerEvent) {
    if (!options.hover || e.pointerType !== 'mouse') return
    clearTimeout(timer)
    timer = setTimeout(() => (open.value = false), 220)
  }

  function onDocumentPointer(e: PointerEvent) {
    if (open.value && root.value && !root.value.contains(e.target as Node)) close()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open.value) return
    close()
    root.value?.querySelector<HTMLElement>('[aria-expanded]')?.focus()
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onDocumentPointer)
    document.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => {
    clearTimeout(timer)
    document.removeEventListener('pointerdown', onDocumentPointer)
    document.removeEventListener('keydown', onKeydown)
  })

  return { open, toggle, close, onPointerEnter, onPointerLeave }
}
