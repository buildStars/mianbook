<script setup lang="ts">
/**
 * 顶部导航的"题库"：展开后按部分列出全部分类，直达分类专题页，学过的分类显示掌握数；底部是"继续上次"。
 * 鼠标停留就展开，键盘和触屏点按钮展开。只在宽屏显示，窄屏用底部标签栏
 */
const route = useRoute()
const { outline } = useOutline()
const { records } = useStudy()
const { last } = useLastVisited()
const root = ref<HTMLElement | null>(null)
const { open, toggle, close, onPointerEnter, onPointerLeave } = usePopover(root, { hover: true })

const active = computed(() => outline.value.some((p) => route.path.startsWith(`/${p.slug}/`)))

/** 分类多的部分（全栈基础）占几列，每列大约 9 个分类 */
const parts = computed(() =>
  outline.value.map((p) => ({
    id: p.id,
    title: p.title,
    total: p.categories.reduce((n, c) => n + c.questions.length, 0),
    cols: Math.min(3, Math.max(1, Math.ceil(p.categories.length / 9))),
    cats: p.categories.map((c) => ({
      id: c.id,
      title: c.title,
      path: `/${p.slug}/${c.slug}`,
      total: c.questions.length,
      mastered: c.questions.filter((q) => records.value[q.id]?.status === 'mastered').length,
    })),
  })),
)
// 只占一列的部分稍微宽一点，"Prompt 与上下文工程"这类长名字在 1024 宽的屏幕上也不用截断
const gridColumns = computed(() =>
  parts.value.map((p) => (p.cols > 1 ? `repeat(${p.cols}, minmax(0, 1fr))` : 'minmax(0, 1.2fr)')).join(' '),
)
const total = computed(() => parts.value.reduce((n, p) => n + p.total, 0))
const isCurrent = (path: string) => route.path === path || route.path.startsWith(`${path}/`)
</script>

<template>
  <div ref="root" class="lib" @pointerenter="onPointerEnter" @pointerleave="onPointerLeave">
    <button
      type="button"
      class="lib-btn"
      :class="{ active, open }"
      :aria-expanded="open"
      aria-controls="library-menu"
      @click="toggle"
    >
      题库<AppIcon name="chevronDown" :size="14" class="chev" />
    </button>
    <Transition name="pop">
      <div v-if="open" id="library-menu" class="lib-panel">
        <div class="lib-inner" :style="{ gridTemplateColumns: gridColumns }">
          <section v-for="p in parts" :key="p.id" class="lib-part" :style="{ gridColumn: `span ${p.cols}` }">
            <p class="lib-part-title">
              <span class="serif">{{ p.title }}</span>
              <span class="num">{{ p.total }} 道</span>
            </p>
            <ul class="lib-cats" :style="{ columnCount: p.cols }">
              <li v-for="c in p.cats" :key="c.id">
                <NuxtLink
                  :to="c.path"
                  class="lib-cat"
                  :class="{ current: isCurrent(c.path) }"
                  :aria-current="route.path === c.path ? 'page' : undefined"
                  @click="close"
                >
                  <span class="cat-title">{{ c.title }}</span>
                  <span class="cat-count num" :class="{ done: c.mastered }" aria-hidden="true">{{ c.mastered ? `${c.mastered}/${c.total}` : c.total }}</span>
                  <span class="visually-hidden">{{ c.mastered ? `，已掌握 ${c.mastered} / ${c.total} 道` : `，${c.total} 道` }}</span>
                </NuxtLink>
              </li>
            </ul>
          </section>
        </div>
        <div class="lib-foot">
          <NuxtLink v-if="last" :to="last.path" class="lib-continue" @click="close">
            <span class="lib-continue-label">继续上次</span>
            <span class="lib-continue-title">No.{{ String(last.num).padStart(2, '0') }} {{ plainTitle(last.title) }}</span>
            <AppIcon name="arrowRight" :size="15" />
          </NuxtLink>
          <span class="lib-hint">共 {{ total }} 道题。点分类可以看全部题目和一句话回答</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.lib {
  display: flex;
  align-self: stretch;
}

.lib-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px 0 12px;
  border: none;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text-2);
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--dur);
}

.lib-btn::after {
  content: '';
  position: absolute;
  right: 10px;
  bottom: -1px;
  left: 12px;
  height: 2px;
  border-radius: 2px;
  background: var(--c-brand);
  transform: scaleX(0);
  transition: transform var(--dur) var(--ease);
}

.lib-btn:hover,
.lib-btn.open,
.lib-btn.active {
  color: var(--c-text-1);
}

.lib-btn.active::after {
  transform: scaleX(1);
}

.chev {
  color: var(--c-text-3);
  transition: transform var(--dur) var(--ease);
}

.lib-btn.open .chev {
  transform: rotate(180deg);
}

.lib-panel {
  position: fixed;
  top: var(--header-h);
  right: 0;
  left: 0;
  z-index: 41;
  border-bottom: 1px solid var(--c-divider);
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-md);
}

.lib-inner {
  display: grid;
  gap: 8px clamp(20px, 2.8vw, 40px);
  max-width: var(--page-w);
  margin: 0 auto;
  padding: 28px 32px 20px;
}

.lib-part-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  white-space: nowrap;
  gap: 10px;
  margin: 0 0 10px;
  padding: 0 10px 10px;
  border-bottom: 1px solid var(--c-divider);
}

.lib-part-title .serif {
  font-size: 16px;
  font-weight: 700;
  color: var(--c-text-1);
}

.lib-part-title .num {
  font-size: 12px;
  color: var(--c-text-3);
}

.lib-cats {
  margin: 0;
  padding: 0;
  list-style: none;
  column-gap: 16px;
}

.lib-cats li {
  break-inside: avoid;
}

.lib-cat {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  font-size: 14px;
  color: var(--c-text-1);
  transition: background-color var(--dur-fast);
}

.lib-cat:hover {
  background: var(--c-default-soft);
}

.lib-cat.current {
  background: var(--c-brand-soft);
  color: var(--c-brand);
  font-weight: 600;
}

.cat-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--c-text-3);
}

.cat-count.done {
  color: var(--st-mastered-text);
}

.lib-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
  /* 和上面分类区的内容左右对齐：宽屏时居中在 --page-w 里，窄一些时左右各留 32px */
  margin: 0 max(32px, calc((100% - var(--page-w)) / 2 + 32px)) 18px;
  padding: 14px 10px 0;
  border-top: 1px solid var(--c-divider);
  font-size: 13px;
}

.lib-continue {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: var(--c-text-1);
}

.lib-continue-label {
  flex: none;
  padding: 2px 8px;
  border-radius: var(--r-full);
  background: var(--c-brand-soft);
  font-size: 12px;
  font-weight: 600;
  color: var(--c-brand);
}

.lib-continue-title {
  overflow: hidden;
  max-width: 420px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lib-continue:hover .lib-continue-title {
  color: var(--c-brand);
}

.lib-hint {
  margin-left: auto;
  color: var(--c-text-3);
}

.pop-enter-active,
.pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
