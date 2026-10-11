<script setup lang="ts">
import { diffHunks, diffLines, diffStats, withInlineChanges } from '#shared/utils/line-diff'

/** 两段 Markdown 的逐行对比：只显示改动附近的几行，其余折叠 */
const props = defineProps<{ oldText: string; newText: string }>()

const lines = computed(() => withInlineChanges(diffLines(props.oldText, props.newText)))
const hunks = computed(() => diffHunks(lines.value))
const stats = computed(() => diffStats(lines.value))
const trailing = computed(() => {
  const shown = hunks.value.reduce((s, h) => s + h.skipped + h.lines.length, 0)
  return lines.value.length - shown
})
</script>

<template>
  <div class="diff">
    <p class="diff-stats">
      <span class="add">+{{ stats.added }}</span>
      <span class="del">−{{ stats.removed }}</span>
      <span>行</span>
    </p>
    <p v-if="!hunks.length" class="a-empty">正文没有差别</p>
    <div v-else class="diff-body">
      <template v-for="(h, i) in hunks" :key="i">
        <div v-if="h.skipped" class="skip">⋯ {{ h.skipped }} 行没有改动</div>
        <div v-for="(l, k) in h.lines" :key="k" class="line" :class="l.type">
          <span class="no">{{ l.oldNo ?? '' }}</span>
          <span class="no">{{ l.newNo ?? '' }}</span>
          <span class="sign" aria-hidden="true">{{ l.type === 'add' ? '+' : l.type === 'del' ? '−' : '' }}</span>
          <span v-if="l.segments" class="text"><template v-for="(seg, n) in l.segments" :key="n"><mark v-if="seg.changed">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
          <span v-else class="text">{{ l.text || ' ' }}</span>
        </div>
      </template>
      <div v-if="trailing > 0" class="skip">⋯ {{ trailing }} 行没有改动</div>
    </div>
  </div>
</template>

<style scoped>
.diff-stats {
  display: flex;
  gap: 8px;
  margin: 0 0 10px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--c-text-3);
}

.diff-stats .add {
  color: var(--c-success);
}

.diff-stats .del {
  color: var(--c-danger);
}

.diff-body {
  overflow: auto;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg-elv);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.7;
}

.line {
  display: grid;
  grid-template-columns: 40px 40px 18px minmax(0, 1fr);
}

.no {
  padding-right: 8px;
  border-right: 1px solid var(--c-divider);
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--c-text-3);
  user-select: none;
}

.sign {
  text-align: center;
  user-select: none;
}

/* 中文一段话通常是一整行，自动换行，不用横向滚动 */
.text {
  padding-right: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.text mark {
  border-radius: 2px;
  color: inherit;
}

.line.add mark {
  background: color-mix(in srgb, var(--st-mastered) 30%, transparent);
}

.line.del mark {
  background: color-mix(in srgb, var(--st-weak) 26%, transparent);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--c-danger) 50%, transparent);
}

.line.add {
  background: var(--c-success-soft);
}

.line.add .sign,
.line.add .text {
  color: var(--c-success);
}

.line.del {
  background: var(--c-danger-soft);
}

.line.del .sign,
.line.del .text {
  color: var(--c-danger);
}

.skip {
  padding: 4px 12px;
  border-block: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--c-text-3);
}

.skip:first-child {
  border-top: none;
}

.skip:last-child {
  border-bottom: none;
}
</style>
