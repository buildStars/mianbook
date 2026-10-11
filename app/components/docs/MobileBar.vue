<script setup lang="ts">
import type { QuestionLink } from '#shared/types/handbook'

/** 手机上固定在底部的操作栏：目录、上一题、AI 面试、下一题 */
defineProps<{ prev: QuestionLink | null; next: QuestionLink | null }>()
const emit = defineEmits<{ interview: [] }>()
const sidebarOpen = useState('sidebar-open', () => false)
</script>

<template>
  <nav class="mobile-bar" aria-label="题目快捷操作">
    <button type="button" class="item" :class="{ on: sidebarOpen }" :aria-expanded="sidebarOpen" @click="sidebarOpen = !sidebarOpen">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h10M4 17h16" /></svg>
      目录
    </button>
    <NuxtLink v-if="prev" :to="prev.path" class="item">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
      上一题
    </NuxtLink>
    <span v-else class="item disabled">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
      上一题
    </span>
    <button type="button" class="item ai" @click="emit('interview')">
      <span class="spark">✦</span>
      AI 面试
    </button>
    <NuxtLink v-if="next" :to="next.path" class="item">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
      下一题
    </NuxtLink>
    <span v-else class="item disabled">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
      下一题
    </span>
  </nav>
</template>

<style scoped>
.mobile-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 35;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--c-divider);
  background: color-mix(in srgb, var(--c-bg) 90%, transparent);
  backdrop-filter: saturate(180%) blur(14px);
}

.item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 48px;
  padding: 0;
  border: none;
  border-radius: var(--r-md);
  background: none;
  color: var(--c-text-2);
  font-size: 11px;
  cursor: pointer;
}

.item:active {
  background: var(--c-default-soft);
}

.item.disabled {
  opacity: 0.35;
}

.item.on {
  color: var(--c-brand);
}

.ai {
  color: var(--ai-text);
  font-weight: 600;
}

.spark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--ai-grad);
  color: #fff;
  font-size: 12px;
}

@media (min-width: 960px) {
  .mobile-bar {
    display: none;
  }
}
</style>
