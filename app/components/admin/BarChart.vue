<script setup lang="ts">
/**
 * 简单的堆叠柱状图：每根柱子由几段组成（比如站点 Key / 自带 Key）。
 * 用 div 画，宽度跟随容器；鼠标悬停显示具体数字
 */
const props = withDefaults(
  defineProps<{
    /** 每根柱子：x 轴标签和各段的值，顺序和 series 一致 */
    data: { label: string; values: number[] }[]
    series: { name: string; color: string }[]
    height?: number
    /** 单位，用在提示里，比如"次" */
    unit?: string
  }>(),
  { height: 180, unit: '' },
)

const total = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** y 轴上限取一个整齐的数 */
const max = computed(() => {
  const top = Math.max(1, ...props.data.map((d) => total(d.values)))
  const step = 10 ** Math.floor(Math.log10(top))
  const nice = Math.ceil(top / step) * step
  // 中间那条刻度也要是整数
  return nice % 2 ? nice + step : nice
})

const tip = (d: { label: string; values: number[] }) =>
  [d.label, ...props.series.map((s, i) => `${s.name} ${d.values[i] ?? 0}${props.unit}`)].join('\n')

// 柱子多时从最后一根往前隔一个显示标签
const showLabel = (i: number) => props.data.length <= 8 || (props.data.length - 1 - i) % 2 === 0
</script>

<template>
  <div class="chart">
    <div class="legend">
      <span v-for="s in series" :key="s.name"><i :style="{ background: s.color }" />{{ s.name }}</span>
    </div>
    <div class="plot" :style="{ height: `${height}px` }">
      <div class="grid" aria-hidden="true">
        <span :data-v="max" />
        <span :data-v="max / 2" />
        <span data-v="0" />
      </div>
      <div class="cols" role="img" :aria-label="data.map(tip).join('；')">
        <div v-for="(d, i) in data" :key="d.label" class="col" :title="tip(d)">
          <div class="stack" :style="{ height: `${(total(d.values) / max) * 100}%` }">
            <span
              v-for="(v, k) in d.values"
              :key="k"
              class="seg"
              :style="{ flexGrow: v, background: series[k]?.color }"
            />
          </div>
          <span class="x" :class="{ hide: !showLabel(i) }">{{ d.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 12px;
  color: var(--c-text-2);
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.plot {
  position: relative;
  margin-left: 32px;
  padding-bottom: 22px;
}

.grid {
  position: absolute;
  inset: 0 0 22px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.grid span {
  position: relative;
  border-top: 1px dashed var(--c-divider);
}

.grid span:last-child {
  border-top-style: solid;
  border-color: var(--c-border);
}

.grid span::before {
  content: attr(data-v);
  position: absolute;
  top: -8px;
  right: calc(100% + 8px);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--c-text-3);
}

.cols {
  position: absolute;
  inset: 0;
  display: flex;
  gap: 6px;
  padding: 0 2px;
}

.col {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: flex-end;
  min-width: 0;
  padding-bottom: 22px;
}

.col:hover .stack {
  filter: brightness(1.08);
}

.col:hover .x {
  color: var(--c-text-1);
}

.stack {
  display: flex;
  flex-direction: column-reverse;
  min-height: 0;
  overflow: hidden;
  border-radius: 4px 4px 1px 1px;
  transition: height var(--dur-slow) var(--ease);
}

.seg {
  flex-basis: 0;
  min-height: 0;
}

.x {
  position: absolute;
  right: -10px;
  bottom: 0;
  left: -10px;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--c-text-3);
}

.x.hide {
  visibility: hidden;
}
</style>
