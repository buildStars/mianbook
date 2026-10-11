<script setup lang="ts">
/** 得分：sm 小胶囊（点评、历史列表）；ring 圆环（面试总结） */
const props = defineProps<{ score: number | null; size?: 'sm' | 'ring' }>()

const level = computed(() => {
  if (props.score === null) return 'none'
  if (props.score >= 8) return 'good'
  if (props.score >= 5) return 'ok'
  return 'bad'
})

const title = computed(() => (props.score === null ? '没有解析出得分' : `${props.score} / 10 分`))

const C = 2 * Math.PI * 26
const offset = computed(() => C * (1 - Math.min(10, Math.max(0, props.score ?? 0)) / 10))
</script>

<template>
  <span v-if="size === 'ring'" class="ring" :class="level" :title="title">
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <circle class="track" cx="32" cy="32" r="26" />
      <circle class="value" cx="32" cy="32" r="26" :stroke-dasharray="C" :stroke-dashoffset="offset" transform="rotate(-90 32 32)" />
    </svg>
    <span class="ring-num"><strong>{{ score ?? '—' }}</strong></span>
  </span>
  <span v-else class="score" :class="level" :title="title">
    <template v-if="score !== null"><strong>{{ score }}</strong><span class="total">/10</span></template>
    <template v-else>—</template>
  </span>
</template>

<style scoped>
.score {
  display: inline-flex;
  flex: none;
  align-items: baseline;
  justify-content: center;
  gap: 1px;
  min-width: 52px;
  padding: 2px 10px;
  border-radius: var(--r-full);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.total {
  font-size: 0.85em;
  opacity: 0.7;
}

.score.good {
  background: color-mix(in srgb, var(--st-mastered) 14%, transparent);
  color: var(--st-mastered-text);
}

.score.ok {
  background: color-mix(in srgb, var(--st-fuzzy) 18%, transparent);
  color: var(--st-fuzzy-text);
}

.score.bad {
  background: color-mix(in srgb, var(--st-weak) 13%, transparent);
  color: var(--st-weak-text);
}

.score.none {
  background: var(--c-default-soft);
  color: var(--c-text-2);
}

.ring {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
}

.ring svg {
  position: absolute;
  inset: 0;
}

.ring circle {
  fill: none;
  stroke-width: 6;
}

.track {
  stroke: var(--c-bg-mute);
}

.value {
  stroke-linecap: round;
  transition: stroke-dashoffset var(--dur-slow) var(--ease);
}

.ring.good .value { stroke: var(--st-mastered); }
.ring.ok .value { stroke: var(--st-fuzzy); }
.ring.bad .value { stroke: var(--st-weak); }
.ring.none .value { stroke: transparent; }

.ring-num strong {
  font-family: var(--font-serif);
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
</style>
