<script setup lang="ts">
const route = useRoute()
const { outline, firstPathOf } = useOutline()
const { records } = useStudy()

const part = computed(() => outline.value.find((p) => route.path.startsWith(`/${p.slug}/`)) ?? outline.value[0])

const stats = computed(() => {
  const items = part.value?.categories.flatMap((c) => c.questions) ?? []
  const count = (s: string) => items.filter((q) => records.value[q.id]?.status === s).length
  const total = items.length || 1
  const mastered = count('mastered')
  return {
    total: items.length,
    mastered,
    review: count('weak') + count('fuzzy'),
    bars: [
      { cls: 'is-mastered', pct: (mastered / total) * 100 },
      { cls: 'is-fuzzy', pct: (count('fuzzy') / total) * 100 },
      { cls: 'is-weak', pct: (count('weak') / total) * 100 },
    ],
  }
})

const masteredIn = (ids: number[]) => ids.filter((id) => records.value[id]?.status === 'mastered').length

function switchPart(event: Event) {
  const target = outline.value.find((p) => p.slug === (event.target as HTMLSelectElement).value)
  if (target) navigateTo(firstPathOf(target))
}

// 分类默认只展开当前题目所在的那个，题目多时目录不至于太长；用户手动展开、收起的以用户为准
const collapsed = ref<Record<number, boolean>>({})
const activeCategoryId = computed(
  () => part.value?.categories.find((c) => c.questions.some((q) => q.path === route.path))?.id,
)
const isCollapsed = (id: number) => collapsed.value[id] ?? id !== activeCategoryId.value
const toggle = (id: number) => (collapsed.value[id] = !isCollapsed(id))

const aside = ref<HTMLElement>()

// 进入页面时让当前题目出现在目录中间。只滚动目录本身，不用 scrollIntoView，以免带动整个页面滚动
onMounted(() =>
  nextTick(() => {
    const el = aside.value
    const active = el?.querySelector<HTMLElement>('a.active')
    if (el && active) el.scrollTop = Math.max(0, active.offsetTop - el.clientHeight / 2)
  }),
)
</script>

<template>
  <aside ref="aside" class="sidebar">
    <nav v-if="part" class="sidebar-nav" aria-label="题目目录">
      <div class="top">
        <label class="part-select">
          <span class="visually-hidden">切换题库分区</span>
          <span class="part-name serif">{{ part.title }}</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
          <select :value="part.slug" @change="switchPart">
            <option v-for="p in outline" :key="p.id" :value="p.slug">{{ p.title }}</option>
          </select>
        </label>

        <NuxtLink to="/progress" class="progress" title="查看我的进度">
          <span class="progress-row">
            <span>已掌握 <b class="num">{{ stats.mastered }}</b><span class="of">/{{ stats.total }}</span></span>
            <span v-if="stats.review" class="review">待复习 {{ stats.review }}</span>
          </span>
          <span class="bar">
            <i v-for="b in stats.bars" :key="b.cls" :class="b.cls" :style="{ width: `${b.pct}%` }" />
          </span>
        </NuxtLink>
      </div>

      <section v-for="cat in part.categories" :key="cat.id" class="group">
        <button
          type="button"
          class="group-title"
          :class="{ current: cat.id === activeCategoryId }"
          :aria-expanded="!isCollapsed(cat.id)"
          @click="toggle(cat.id)"
        >
          <span class="group-name">{{ cat.title }}</span>
          <span class="group-count num">{{ masteredIn(cat.questions.map((q) => q.id)) }}/{{ cat.questions.length }}</span>
          <svg :class="{ rotated: isCollapsed(cat.id) }" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <!-- 收起的分类不渲染：全栈基础有几百道题，全部输出会让每个题目页的 HTML 多出近 200 KB -->
        <ul v-if="!isCollapsed(cat.id)">
          <li v-for="q in cat.questions" :key="q.id">
            <NuxtLink :to="q.path" class="item" :class="{ active: route.path === q.path }" :title="`${q.num}. ${plainTitle(q.title)}`">
              <span class="no num">{{ String(q.num).padStart(2, '0') }}</span>
              <span class="text">{{ plainTitle(q.title) }}</span>
              <span v-if="records[q.id]?.starred" class="star" aria-label="已收藏">★</span>
              <span
                class="dot"
                :class="records[q.id]?.status && `is-${records[q.id]!.status}`"
                :aria-label="records[q.id]?.status ? STATUS_LABELS[records[q.id]!.status!] : '未学'"
              />
            </NuxtLink>
          </li>
        </ul>
      </section>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  position: fixed;
  top: var(--header-h);
  bottom: 0;
  left: 0;
  z-index: 30;
  width: min(var(--sidebar-w), 86vw);
  border-right: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  transform: translateX(-100%);
  transition: transform var(--dur-slow) var(--ease);
}

.sidebar.open {
  transform: none;
  box-shadow: var(--shadow-lg);
}

@media (min-width: 960px) {
  .sidebar {
    width: var(--sidebar-w);
    transform: none;
  }

  .sidebar.open {
    box-shadow: none;
  }
}

.sidebar-nav {
  padding: 0 12px 48px;
}

/* 手机上底部有操作栏，留出位置 */
@media (max-width: 959px) {
  .sidebar-nav {
    padding-bottom: calc(112px + env(safe-area-inset-bottom));
  }
}

/* 触屏设备上每一行至少 44px 高，手指不容易点错 */
@media (pointer: coarse) {
  .item,
  .group-title {
    min-height: 44px;
  }
}

/* 顶部：分区切换 + 进度，滚动时固定 */
.top {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0 -12px 8px;
  padding: 16px 12px 12px;
  background: linear-gradient(var(--c-bg-soft) 85%, transparent);
}

.part-select {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  cursor: pointer;
  transition: border-color var(--dur);
}

.part-select:hover,
.part-select:focus-within {
  border-color: var(--c-border);
}

.part-select:focus-within {
  outline: 2px solid var(--c-brand);
  outline-offset: 1px;
}

.part-name {
  flex: 1;
  font-size: 15px;
  font-weight: 700;
}

.part-select svg {
  color: var(--c-text-3);
}

.part-select select {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
}

.progress {
  display: block;
  margin-top: 10px;
  padding: 10px 12px 12px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg-elv);
  color: var(--c-text-2);
  font-size: 12px;
  transition: border-color var(--dur);
}

.progress:hover {
  border-color: var(--c-border);
}

.progress-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}

.progress b {
  margin-left: 2px;
  font-size: 15px;
  color: var(--c-text-1);
}

.of {
  color: var(--c-text-3);
}

.review {
  color: var(--st-weak-text);
  font-weight: 500;
}

.bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  background: var(--c-bg-mute);
  overflow: hidden;
}

.bar i {
  height: 100%;
  transition: width var(--dur-slow) var(--ease);
}

.bar .is-mastered { background: var(--st-mastered); }
.bar .is-fuzzy { background: var(--st-fuzzy); }
.bar .is-weak { background: var(--st-weak); }

/* 分类 */
.group + .group {
  margin-top: 6px;
}

.group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: none;
  border-radius: var(--r-sm);
  background: none;
  color: var(--c-text-1);
  cursor: pointer;
}

.group-title:hover {
  background: var(--c-default-soft);
}

.group-name {
  flex: 1;
  font-size: 13px;
  /* 微软雅黑只有常规和粗体两档，500 以上中文会直接变粗，所以收起时用 500 */
  font-weight: 500;
  text-align: left;
  color: var(--c-text-2);
}

.group-title.current .group-name,
.group-title[aria-expanded='true'] .group-name {
  font-weight: 700;
  color: var(--c-text-1);
}

.group-count {
  font-size: 12px;
  color: var(--c-text-3);
}

.group-title svg {
  color: var(--c-text-3);
  transition: transform var(--dur) var(--ease);
}

.group-title svg.rotated {
  transform: rotate(-90deg);
}

ul {
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}

.item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  font-size: 14px;
  line-height: 22px;
  color: var(--c-text-2);
  transition:
    background-color var(--dur-fast),
    color var(--dur-fast);
}

.item:hover {
  background: var(--c-default-soft);
  color: var(--c-text-1);
}

.item.active {
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  font-weight: 600;
  box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--c-divider);
}

.item.active::before {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: -1px;
  width: 3px;
  border-radius: 3px;
  background: var(--c-brand);
}

.no {
  flex: none;
  width: 20px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--c-text-3);
}

.item.active .no {
  color: var(--c-brand);
}

.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.star {
  font-size: 12px;
}
</style>
