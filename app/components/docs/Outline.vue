<script setup lang="ts">
import type { TocItem } from '#shared/types/handbook'

const props = defineProps<{ toc: TocItem[] }>()
const activeId = ref('')

/** 二级标题按正文里的章节编号显示 01、02 …… */
const items = computed(() => {
  let n = 0
  return props.toc.map((item) => ({ ...item, no: item.level === 2 ? String(++n).padStart(2, '0') : '' }))
})

let observer: IntersectionObserver | undefined

function observe() {
  observer?.disconnect()
  const visible = new Set<string>()
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target.id)
        else visible.delete(e.target.id)
      }
      // 取文档顺序里第一个可见的标题
      const first = props.toc.find((t) => visible.has(t.id))
      if (first) activeId.value = first.id
    },
    { rootMargin: '-80px 0px -60% 0px' },
  )
  for (const item of props.toc) {
    const el = document.getElementById(item.id)
    if (el) observer.observe(el)
  }
}

onMounted(() => nextTick(observe))
watch(
  () => props.toc,
  () => nextTick(observe),
)
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <nav v-if="toc.length" class="outline" aria-label="本页目录">
    <p class="title">本页目录</p>
    <ul>
      <li v-for="item in items" :key="item.id" :class="`level-${item.level}`">
        <a :href="`#${item.id}`" :class="{ active: activeId === item.id }">
          <span v-if="item.no" class="no">{{ item.no }}</span>{{ item.text }}
        </a>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.outline {
  font-size: 13px;
}

.title {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--c-text-3);
}

ul {
  margin: 0;
  padding: 0;
  border-left: 1px solid var(--c-divider);
  list-style: none;
}

li a {
  position: relative;
  display: block;
  padding: 4px 0 4px 14px;
  overflow: hidden;
  color: var(--c-text-2);
  line-height: 1.6;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--dur);
}

li a::before {
  content: '';
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: -1px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background-color var(--dur);
}

li a:hover {
  color: var(--c-text-1);
}

li a.active {
  color: var(--c-brand);
  font-weight: 500;
}

li a.active::before {
  background: var(--c-brand);
}

.no {
  margin-right: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--c-text-3);
}

.active .no {
  color: inherit;
}

.level-3 a {
  padding-left: 40px;
  font-size: 12.5px;
}
</style>
