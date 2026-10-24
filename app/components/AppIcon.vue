<script lang="ts">
/** 前台导航用的线性图标，24×24 网格、1.8 描边，颜色跟随文字；和后台的 AdminIcon 同一种画法 */
const PATHS = {
  progress: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v9l6.4 6.4',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  note: 'M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  review: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 8v4l3 2',
  report: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sparkle: 'M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z',
  ask: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM9 10h6M9 14h4',
  connect: 'M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5',
  admin: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7M8 11h5',
  theme: 'M12 21a9 9 0 1 0 0-18v18z',
  chevronRight: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
} as const

export type AppIconName = keyof typeof PATHS
</script>

<script setup lang="ts">
import type { PropType } from 'vue'

const props = defineProps({
  name: { type: String as PropType<AppIconName>, required: true },
  size: { type: Number, default: 18 },
  /** 星标等需要实心的图标 */
  filled: { type: Boolean, default: false },
})
</script>

<template>
  <svg
    class="app-icon"
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    :fill="props.filled ? 'currentColor' : 'none'"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="PATHS[props.name]" />
  </svg>
</template>

<style scoped>
.app-icon {
  flex: none;
}
</style>
