<script setup lang="ts">
import type { FlatQuestion } from '~/composables/useOutline'

/**
 * 我的收藏：收藏的题按分类分组（目录顺序），笔记按最近修改在前，?tab=notes 打开笔记。
 * 在这里取消收藏，题目先留在原处变淡，点星标可以收藏回来；离开页面后才不再显示
 */
const route = useRoute()
const router = useRouter()
const { loggedIn } = useUserSession()
const { records, ready, toggleStar } = useStudy()
const { all } = useOutline()
const { starred, noted } = useCollection()
const { last } = useLastVisited()

type Tab = 'stars' | 'notes'
const tab = computed<Tab>(() => (route.query.tab === 'notes' ? 'notes' : 'stars'))
const setTab = (t: Tab) => router.replace({ query: t === 'notes' ? { tab: 'notes' } : {} })
const heading = computed(() => (tab.value === 'notes' ? '我的笔记' : '我的收藏'))
useHead({ title: heading })

const kept = ref(new Set<number>())
const isStarred = (id: number) => !!records.value[id]?.starred
function onStar(id: number) {
  if (isStarred(id)) kept.value = new Set(kept.value).add(id)
  toggleStar(id)
}

const groups = computed(() => {
  const map = new Map<number, { id: number; title: string; partTitle: string; path: string; items: FlatQuestion[] }>()
  for (const q of all.value) {
    if (!isStarred(q.id) && !kept.value.has(q.id)) continue
    let g = map.get(q.categoryId)
    if (!g) {
      g = { id: q.categoryId, title: q.categoryTitle, partTitle: q.partTitle, path: `/${q.partSlug}/${q.categorySlug}`, items: [] }
      map.set(q.categoryId, g)
    }
    g.items.push(q)
  }
  return [...map.values()]
})

const startPath = computed(() => last.value?.path ?? all.value[0]?.path ?? '/')
const pad = (n: number) => String(n).padStart(2, '0')
const statusOf = (id: number) => records.value[id]?.status ?? null
</script>

<template>
  <div class="page container">
    <nav class="crumbs" aria-label="面包屑">
      <NuxtLink to="/me" class="tap">个人中心</NuxtLink>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{{ heading }}</span>
    </nav>

    <header class="page-head">
      <h1 class="serif">{{ heading }}</h1>
      <p class="sub">收藏过的题和写过的笔记都在这里。题目页标题下面点"收藏"，每道题底部可以写笔记。</p>
    </header>

    <div class="tabs" role="group" aria-label="收藏还是笔记">
      <button type="button" :aria-pressed="tab === 'stars'" @click="setTab('stars')">
        <AppIcon name="star" :size="16" :filled="tab === 'stars'" />收藏<span v-if="ready" class="num">{{ starred.length }}</span>
      </button>
      <button type="button" :aria-pressed="tab === 'notes'" @click="setTab('notes')">
        <AppIcon name="note" :size="16" />笔记<span v-if="ready" class="num">{{ noted.length }}</span>
      </button>
    </div>

    <p v-if="ready && !loggedIn && (starred.length || noted.length)" class="guest">
      这些记录只存在这台设备上。<NuxtLink :to="`/login?redirect=${encodeURIComponent(route.fullPath)}`">登录</NuxtLink>后会自动合并到账号，换设备也能看到。
    </p>

    <div v-if="!ready" class="loading" aria-busy="true">
      <span v-for="i in 3" :key="i" class="skeleton" />
    </div>

    <!-- 收藏 -->
    <template v-else-if="tab === 'stars'">
      <div v-if="!groups.length" class="empty">
        <span class="empty-icon"><AppIcon name="star" :size="26" /></span>
        <p class="empty-title serif">还没有收藏的题</p>
        <p class="empty-text">看到想反复看的题，在标题下面点"收藏"，就会按分类放到这里。</p>
        <NuxtLink :to="startPath" class="btn btn-primary">去刷题</NuxtLink>
      </div>
      <section v-for="g in groups" :key="g.id" class="group">
        <h2 class="group-head">
          <NuxtLink :to="g.path" class="group-title serif">{{ g.title }}</NuxtLink>
          <span class="group-part">{{ g.partTitle }}</span>
          <span class="group-count num">{{ g.items.length }} 道</span>
        </h2>
        <ul class="items">
          <li v-for="q in g.items" :key="q.id" class="item" :class="{ off: !isStarred(q.id) }">
            <NuxtLink :to="q.path" class="item-link">
              <span class="item-no num">{{ pad(q.num) }}</span>
              <span class="item-main">
                <span class="item-title serif"><RichTitle :title="q.title" /></span>
                <span class="item-meta">
                  <DifficultyBadge :value="q.difficulty" />
                  <span class="status">
                    <span class="dot" :class="statusOf(q.id) && `is-${statusOf(q.id)}`" />{{ statusOf(q.id) ? STATUS_LABELS[statusOf(q.id)!] : '未标记' }}
                  </span>
                  <span v-if="records[q.id]?.note?.trim()" class="has-note"><AppIcon name="note" :size="13" />有笔记</span>
                  <span v-if="!isStarred(q.id)" class="removed">已取消收藏</span>
                </span>
              </span>
            </NuxtLink>
            <button
              type="button"
              class="star-btn"
              :aria-pressed="isStarred(q.id)"
              :aria-label="`${isStarred(q.id) ? '取消收藏' : '重新收藏'}：${plainTitle(q.title)}`"
              :title="isStarred(q.id) ? '取消收藏' : '重新收藏'"
              @click="onStar(q.id)"
            >
              <AppIcon name="star" :size="19" :filled="isStarred(q.id)" />
            </button>
          </li>
        </ul>
      </section>
    </template>

    <!-- 笔记 -->
    <template v-else>
      <div v-if="!noted.length" class="empty">
        <span class="empty-icon"><AppIcon name="note" :size="26" /></span>
        <p class="empty-title serif">还没有笔记</p>
        <p class="empty-text">每道题底部都能写笔记，自动保存。用自己的话复述一遍，比看十遍都管用。</p>
        <NuxtLink :to="startPath" class="btn btn-primary">去刷题</NuxtLink>
      </div>
      <ul v-else class="notes">
        <li v-for="q in noted" :key="q.id" class="note">
          <NuxtLink :to="q.path" class="note-title serif"><RichTitle :title="q.title" /></NuxtLink>
          <p class="note-meta">
            {{ q.categoryTitle }} · <time :datetime="records[q.id]!.updatedAt" :title="formatDateTime(records[q.id]!.updatedAt)">{{ relativeTime(records[q.id]!.updatedAt) }}</time>
          </p>
          <p class="note-text">{{ records[q.id]!.note }}</p>
          <NuxtLink :to="`${q.path}#note-${q.id}`" class="note-edit">去题目页修改<AppIcon name="arrowRight" :size="14" /></NuxtLink>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 860px;
  padding-top: 32px;
  padding-bottom: 80px;
}

.crumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: var(--c-text-3);
}

.crumbs a {
  color: var(--c-text-2);
}

.crumbs a:hover {
  color: var(--c-brand);
}

.page-head {
  margin-top: 20px;
}

.page-head h1 {
  margin: 0;
  font-size: clamp(30px, 4.4vw, 42px);
  font-weight: 800;
  line-height: 1.2;
}

.sub {
  max-width: 640px;
  margin: 12px 0 0;
  font-size: 15px;
  line-height: 1.8;
  color: var(--c-text-2);
}

.tabs {
  display: inline-flex;
  gap: 4px;
  margin-top: 28px;
  padding: 4px;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
}

.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 16px;
  border: none;
  border-radius: var(--r-sm);
  background: none;
  font: inherit;
  font-size: 14px;
  color: var(--c-text-2);
  cursor: pointer;
}

.tabs button[aria-pressed='true'] {
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-xs);
  font-weight: 600;
  color: var(--c-text-1);
}

.tabs button[aria-pressed='true'] .app-icon {
  color: var(--st-star);
}

.tabs .num {
  font-size: 12px;
  color: var(--c-text-3);
}

.guest {
  margin: 16px 0 0;
  padding: 10px 14px;
  border-radius: var(--r-md);
  background: var(--c-brand-softer);
  font-size: 13px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.guest a {
  font-weight: 600;
  color: var(--c-brand);
}

.loading {
  display: grid;
  gap: 12px;
  margin-top: 28px;
}

.skeleton {
  height: 76px;
  border-radius: var(--r-lg);
  background: var(--c-bg-soft);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 28px;
  padding: 48px 24px;
  border: 1px dashed var(--c-border);
  border-radius: var(--r-xl);
  text-align: center;
}

.empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--c-bg-soft);
  color: var(--c-text-3);
}

.empty-title {
  margin: 16px 0 0;
  font-size: 20px;
  font-weight: 700;
}

.empty-text {
  max-width: 420px;
  margin: 8px 0 20px;
  font-size: 14px;
  line-height: 1.75;
  color: var(--c-text-2);
}

.group {
  margin-top: 32px;
}

.group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0 0 12px;
}

.group-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--c-text-1);
}

.group-title:hover {
  color: var(--c-brand);
}

.group-part {
  font-size: 13px;
  font-weight: 400;
  color: var(--c-text-3);
}

.group-count {
  margin-left: auto;
  font-size: 13px;
  font-weight: 400;
  color: var(--c-text-3);
}

.items {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease),
    opacity var(--dur) var(--ease);
}

.item:hover {
  border-color: var(--c-border);
  box-shadow: var(--shadow-sm);
}

.item.off {
  border-style: dashed;
  box-shadow: none;
}

.item.off .item-link {
  opacity: 0.6;
}

.item-link {
  display: flex;
  flex: 1;
  gap: 14px;
  min-width: 0;
  padding: 16px 4px 16px 20px;
  color: var(--c-text-1);
}

.item-no {
  flex: none;
  width: 32px;
  padding-top: 3px;
  font-size: 13px;
  color: var(--c-brand);
}

.item-main {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.item-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.5;
}

.item-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  font-size: 13px;
  color: var(--c-text-2);
}

.status,
.has-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.removed {
  color: var(--c-text-3);
}

.star-btn {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 52px;
  border: none;
  border-radius: 0 var(--r-lg) var(--r-lg) 0;
  background: none;
  color: var(--c-text-3);
  cursor: pointer;
  transition:
    color var(--dur-fast),
    background-color var(--dur-fast);
}

.star-btn[aria-pressed='true'] {
  color: var(--st-star);
}

.star-btn:hover {
  background: var(--c-default-soft);
}

.notes {
  display: grid;
  gap: 12px;
  margin: 28px 0 0;
  padding: 0;
  list-style: none;
}

.note {
  padding: 18px 20px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
}

.note-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.5;
  color: var(--c-text-1);
}

.note-title:hover {
  color: var(--c-brand);
}

.note-meta {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--c-text-3);
}

.note-text {
  display: -webkit-box;
  margin: 12px 0 0;
  padding: 12px 14px;
  overflow: hidden;
  border-left: 3px solid var(--st-star);
  border-radius: 0 var(--r-md) var(--r-md) 0;
  background: var(--c-bg-soft);
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--c-text-1);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
}

.note-edit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-brand);
}

@media (max-width: 640px) {
  .page {
    padding-top: 24px;
  }

  .tabs {
    display: flex;
  }

  .tabs button {
    flex: 1;
    justify-content: center;
  }

  .item-link {
    gap: 10px;
    padding: 14px 0 14px 14px;
  }

  .item-no {
    width: 26px;
  }

  .item-title {
    font-size: 16px;
  }

  .star-btn {
    width: 48px;
  }

  .note {
    padding: 16px;
  }
}

@media (pointer: coarse) {
  .tabs button {
    min-height: 44px;
  }
}
</style>
