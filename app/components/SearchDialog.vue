<script setup lang="ts">
import type { SearchHit } from '#shared/types/handbook'

const open = defineModel<boolean>('open', { required: true })

const SUGGESTIONS = ['事件循环', '闭包', '强缓存', 'Vue 响应式', 'HTTPS', 'RAG', 'Agent']

const query = ref('')
const results = ref<SearchHit[]>([])
const active = ref(0)
const loading = ref(false)
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()

let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0

watch(query, (q) => {
  clearTimeout(timer)
  if (!q.trim()) {
    results.value = []
    return
  }
  timer = setTimeout(async () => {
    const current = ++seq
    loading.value = true
    try {
      const hits = await $fetch<SearchHit[]>('/api/search', { query: { q } })
      // 只采用最后一次请求的结果，避免先发后到覆盖
      if (current === seq) {
        results.value = hits
        active.value = 0
      }
    } finally {
      if (current === seq) loading.value = false
    }
  }, 180)
})

watch(open, async (value) => {
  if (value) {
    await nextTick()
    input.value?.focus()
    input.value?.select()
  }
})

function go(hit?: SearchHit) {
  if (!hit) return
  open.value = false
  navigateTo(hit.path)
}

function askAi() {
  const q = query.value.trim()
  open.value = false
  navigateTo({ path: '/ask', query: { q } })
}

function move(step: number) {
  if (!results.value.length) return
  active.value = (active.value + step + results.value.length) % results.value.length
  nextTick(() => list.value?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }))
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="search-mask" @click.self="open = false">
      <div class="search-box" role="dialog" aria-label="搜索题目" @keydown.esc="open = false">
        <div class="search-input">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            ref="input"
            v-model="query"
            type="search"
            placeholder="搜索题目，例如：事件循环、强缓存、RAG"
            aria-label="搜索关键词"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="go(results[active])"
          >
          <button type="button" class="close" aria-label="关闭搜索" @click="open = false"><span class="kbd-hint">Esc</span><span class="touch-only">取消</span></button>
        </div>
        <button v-if="query.trim().length >= 2" type="button" class="ask" @click="askAi">
          <span class="ask-mark" aria-hidden="true">✦</span>
          <span class="ask-text">让 AI 根据手册回答：<b>{{ query.trim() }}</b></span>
          <span class="ask-go">问手册 →</span>
        </button>
        <ul v-if="results.length" ref="list" class="results">
          <li v-for="(hit, i) in results" :key="hit.id">
            <a
              :href="hit.path"
              :class="{ active: i === active }"
              @click.prevent="go(hit)"
              @mouseenter="active = i"
            >
              <span class="crumb">{{ hit.part }}<i>/</i>{{ hit.category }}</span>
              <span class="title">{{ plainTitle(hit.title) }}</span>
              <!-- snippet 由服务端转义，只保留了 mark 标签 -->
              <span class="snippet" v-html="hit.snippet" />
            </a>
          </li>
        </ul>
        <p v-else-if="query.trim() && !loading" class="empty">没有找到"{{ query }}"相关的题目，换个说法试试</p>
        <div v-else-if="!query.trim()" class="suggest">
          <p>试试搜索</p>
          <div class="suggest-list">
            <button v-for="s in SUGGESTIONS" :key="s" type="button" class="chip" @click="query = s">{{ s }}</button>
          </div>
        </div>
        <div class="footer kbd-hint">
          <span><kbd>↑</kbd><kbd>↓</kbd> 切换</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.search-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  justify-content: center;
  padding: 12vh 16px 16px;
  background: rgba(20, 18, 15, 0.45);
  backdrop-filter: blur(4px);
  animation: fade-in var(--dur) var(--ease);
}

.search-box {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 640px;
  max-height: 70vh;
  border: 1px solid var(--c-divider);
  border-radius: 18px;
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: pop-in var(--dur-slow) var(--ease);
}

.search-input {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  height: 62px;
  padding: 0 18px;
  border-bottom: 1px solid var(--c-divider);
  color: var(--c-text-3);
}

.search-input input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  color: var(--c-text-1);
  font-size: 17px;
}

.search-input input::-webkit-search-cancel-button {
  display: none;
}

.close {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-xs);
  background: var(--c-bg-soft);
  font-size: 11px;
  color: var(--c-text-3);
  cursor: pointer;
}

.ask {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  margin: 8px 8px 0;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  background: var(--ai-soft);
  color: var(--c-text-1);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}

.ask:hover,
.ask:focus-visible {
  border-color: var(--ai-via);
}

.ask-mark {
  color: var(--ai-text);
}

.ask-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-2);
}

.ask-text b {
  color: var(--c-text-1);
}

.ask-go {
  flex: none;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ai-text);
}

.results {
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  list-style: none;
}

.results a {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border-radius: var(--r-md);
  color: var(--c-text-1);
}

.results a.active {
  background: var(--c-brand-softer);
}

.results a.active::before {
  content: '';
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 0;
  width: 3px;
  border-radius: 3px;
  background: var(--c-brand);
}

.crumb {
  font-size: 12px;
  color: var(--c-text-3);
}

.crumb i {
  margin: 0 6px;
  font-style: normal;
  opacity: 0.6;
}

.title {
  font-size: 15px;
  font-weight: 600;
}

.snippet {
  font-size: 13px;
  line-height: 1.65;
  color: var(--c-text-2);
}

.snippet :deep(mark) {
  padding: 0 1px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--c-brand) 16%, transparent);
  color: var(--c-brand);
}

.empty {
  margin: 0;
  padding: 40px 16px;
  text-align: center;
  color: var(--c-text-2);
}

.suggest {
  padding: 20px 18px 24px;
}

.suggest p {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--c-text-3);
}

.suggest-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.suggest .chip {
  height: 30px;
  padding: 0 12px;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color var(--dur),
    color var(--dur);
}

.suggest .chip:hover {
  border-color: var(--c-brand);
  color: var(--c-brand);
}

.footer {
  display: flex;
  flex: none;
  gap: 16px;
  padding: 10px 18px;
  border-top: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
  font-size: 12px;
  color: var(--c-text-3);
}

.footer span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
}

@keyframes pop-in {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.98);
  }
}

@media (max-width: 640px) {
  .search-mask {
    padding-top: 8vh;
  }

  .footer {
    display: none;
  }
}
</style>

