<script setup lang="ts">
/**
 * 雷达图：每个轴一个分类，数值 0～100。
 * series 可以有两组（掌握度、AI 面试得分），第二组允许缺值（没面试过的分类不画点）
 */
const props = defineProps<{
  axes: string[]
  series: { name: string; values: (number | null)[]; tone: 'brand' | 'ai' }[]
}>()

const SIZE = 360
const C = SIZE / 2
const R = 120
const n = computed(() => props.axes.length)

const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n.value
/** 坐标保留一位小数：服务端和浏览器的三角函数结果在最后几位可能不同，不取整会导致水合不匹配 */
const round = (x: number) => Math.round(x * 10) / 10
const point = (i: number, v: number) => {
  const r = (Math.max(0, Math.min(100, v)) / 100) * R
  return [round(C + r * Math.cos(angle(i))), round(C + r * Math.sin(angle(i)))] as const
}

const rings = [25, 50, 75, 100]
const ringPath = (v: number) =>
  props.axes.map((_, i) => point(i, v).join(',')).join(' ')

/** 有缺值时连线跳过，只画有值的点；三个点以上才画多边形 */
const shapes = computed(() =>
  props.series.map((s) => {
    const pts = s.values.map((v, i) => (v === null ? null : point(i, v)))
    const present = pts.filter((p): p is readonly [number, number] => p !== null)
    return {
      ...s,
      dots: present,
      polygon: present.length >= 3 && present.length === pts.length ? present.map((p) => p.join(',')).join(' ') : null,
    }
  }),
)

/** 标签放在最外圈外侧，按所在方位决定对齐方式 */
const labels = computed(() =>
  props.axes.map((text, i) => {
    const a = angle(i)
    const x = round(C + (R + 18) * Math.cos(a))
    const y = round(C + (R + 18) * Math.sin(a))
    const cos = Math.cos(a)
    return { text, x, y, anchor: Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end' }
  }),
)
</script>

<template>
  <svg :viewBox="`-60 -10 ${SIZE + 120} ${SIZE + 20}`" class="radar" role="img" :aria-label="`各分类${series.map((s) => s.name).join('和')}雷达图`">
    <polygon v-for="v in rings" :key="v" class="ring" :points="ringPath(v)" />
    <line v-for="(_, i) in axes" :key="`axis-${i}`" class="axis" :x1="C" :y1="C" :x2="point(i, 100)[0]" :y2="point(i, 100)[1]" />
    <g v-for="s in shapes" :key="s.name" :class="['series', s.tone]">
      <polygon v-if="s.polygon" :points="s.polygon" />
      <circle v-for="(p, k) in s.dots" :key="k" :cx="p[0]" :cy="p[1]" r="3" />
    </g>
    <text v-for="(l, i) in labels" :key="`label-${i}`" :x="l.x" :y="l.y" :text-anchor="l.anchor" dominant-baseline="middle" class="label">
      {{ l.text }}
    </text>
  </svg>
</template>

<style scoped>
.radar {
  width: 100%;
  height: auto;
  overflow: visible;
}

.ring {
  fill: none;
  stroke: var(--c-divider);
}

.axis {
  stroke: var(--c-divider);
  stroke-dasharray: 2 3;
}

.series polygon {
  stroke-width: 2;
  stroke-linejoin: round;
}

.series.brand polygon {
  fill: color-mix(in srgb, var(--c-brand) 16%, transparent);
  stroke: var(--c-brand);
}

.series.brand circle {
  fill: var(--c-brand);
}

.series.ai polygon {
  fill: color-mix(in srgb, var(--ai-via) 10%, transparent);
  stroke: var(--ai-via);
  stroke-dasharray: 5 4;
}

.series.ai circle {
  fill: var(--ai-via);
}

.label {
  font-size: 12px;
  fill: var(--c-text-2);
}
</style>
