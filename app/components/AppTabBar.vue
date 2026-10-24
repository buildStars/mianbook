<script setup lang="ts">
/**
 * 手机上的底部标签栏（顶部导航在窄屏隐藏）：首页、题库、复习、模拟面试、我的。
 * "我的"是个人中心，进度、收藏、笔记、周报、问手册等入口都在那里。
 * 题目页有自己的底部操作栏（目录、上一题、AI 面试、下一题），那里不显示
 */
const route = useRoute()
const { all } = useOutline()
const { last } = useLastVisited()
const { summary } = useReview()

/** "题库"回到上次看的题，没有就从第一题开始 */
const libraryPath = computed(() => last.value?.path ?? all.value[0]?.path ?? '/')
const due = computed(() => summary.value?.dueToday ?? 0)
/** 从个人中心进去的页面，"我的"保持选中 */
const MINE = ['/me', '/progress', '/favorites', '/report', '/connect', '/ask']

const tabs = computed(() => [
  { to: '/', label: '首页', icon: 'home', active: route.path === '/' },
  { to: libraryPath.value, label: '题库', icon: 'book', active: false },
  { to: '/review', label: '复习', icon: 'review', active: route.path === '/review', badge: due.value },
  { to: '/mock', label: '模拟面试', icon: 'mock', active: route.path.startsWith('/mock') },
  { to: '/me', label: '我的', icon: 'me', active: MINE.includes(route.path) },
])
</script>

<template>
  <nav class="tab-bar" aria-label="主导航">
    <NuxtLink v-for="t in tabs" :key="t.label" :to="t.to" class="tab" :class="{ active: t.active }" :aria-current="t.active ? 'page' : undefined">
      <span class="icon" aria-hidden="true">
        <svg v-if="t.icon === 'home'" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
        <svg v-else-if="t.icon === 'book'" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 21V5M8 7h7M8 11h5" /></svg>
        <svg v-else-if="t.icon === 'review'" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5M12 8v4l3 2" /></svg>
        <svg v-else-if="t.icon === 'mock'" viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>
        <svg v-else viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
        <span v-if="t.badge" class="badge" :aria-label="`今天待复习 ${t.badge} 道`">{{ t.badge > 99 ? '99+' : t.badge }}</span>
      </span>
      {{ t.label }}
    </NuxtLink>
  </nav>
</template>

<style scoped>
.tab-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 35;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  padding: 4px 6px calc(4px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--c-divider);
  background: color-mix(in srgb, var(--c-bg) 90%, transparent);
  backdrop-filter: saturate(180%) blur(14px);
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 52px;
  border-radius: var(--r-md);
  color: var(--c-text-3);
  font-size: 11px;
}

.tab:active {
  background: var(--c-default-soft);
}

.tab.active {
  color: var(--c-brand);
  font-weight: 600;
}

.icon {
  position: relative;
  display: inline-flex;
}

.badge {
  position: absolute;
  top: -5px;
  left: 13px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--r-full);
  background: var(--c-seal);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  color: #fff;
}

/* 宽屏用顶部导航 */
@media (min-width: 960px) {
  .tab-bar {
    display: none;
  }
}
</style>
