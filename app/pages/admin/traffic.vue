<script setup lang="ts">
import type { AdminTraffic } from '#shared/types/admin'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: '访问' })

const RANGES = [7, 30, 90] as const
const days = ref<(typeof RANGES)[number]>(30)
// 服务端渲染时不知道浏览器时区，只在浏览器里请求
const { data, pending, error } = useFetch<AdminTraffic>('/api/admin/traffic', {
  key: 'admin-traffic',
  query: computed(() => ({ days: days.value, tz: import.meta.client ? new Date().getTimezoneOffset() : 0 })),
  server: false,
})

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : '—')

const chart = computed(() =>
  (data.value?.daily ?? []).map((d) => ({ label: d.date.slice(5).replace('-', '/'), values: [d.visitors] })),
)
const funnelMax = computed(() => Math.max(1, ...(data.value?.funnel.map((f) => f.value) ?? [1])))
const deviceTotal = computed(() => (data.value ? data.value.devices.mobile + data.value.devices.desktop : 0))
const refMax = computed(() => Math.max(1, ...(data.value?.referrers.map((r) => r.visitors) ?? [1])))
</script>

<template>
  <div>
    <AdminPageHead :eyebrow="`运营 · 最近 ${days} 天`" title="访问">
      <template #desc>自建统计，不用第三方、不存 IP。开了"请勿追踪"的浏览器、爬虫和管理员自己都不计入。</template>
      <div class="a-seg" role="group" aria-label="统计范围">
        <button v-for="d in RANGES" :key="d" type="button" :aria-pressed="days === d" @click="days = d">{{ d }} 天</button>
      </div>
    </AdminPageHead>

    <div v-if="error" class="a-alert bad"><AdminIcon name="alert" :size="16" />{{ errorMessage(error) }}</div>

    <template v-if="data">
      <section class="kpis" aria-label="关键指标" :class="{ dim: pending }">
        <div class="a-card kpi">
          <p class="kpi-label"><AdminIcon name="eye" :size="15" />访客</p>
          <p class="kpi-value a-num">{{ compactNumber(data.totals.visitors) }}<small>人</small></p>
          <p class="kpi-sub">浏览 {{ compactNumber(data.totals.views) }} 次 · 两天以上来过的 {{ data.totals.returning }} 人</p>
        </div>
        <div class="a-card kpi">
          <p class="kpi-label"><AdminIcon name="users" :size="15" />新注册</p>
          <p class="kpi-value a-num">{{ data.totals.signups }}<small>人</small></p>
          <p class="kpi-sub">访客转化率 {{ pct(data.totals.signups, data.totals.visitors) }}</p>
        </div>
        <div class="a-card kpi">
          <p class="kpi-label"><AdminIcon name="sparkle" :size="15" />做过 AI 面试</p>
          <p class="kpi-value a-num">{{ data.totals.activated }}<small>人</small></p>
          <p class="kpi-sub">占新注册的 {{ pct(data.totals.activated, data.totals.signups) }}</p>
        </div>
        <div class="a-card kpi">
          <p class="kpi-label"><AdminIcon name="pulse" :size="15" />设备</p>
          <p class="kpi-value a-num">{{ pct(data.devices.mobile, deviceTotal) }}<small>手机</small></p>
          <p class="kpi-sub">手机 {{ data.devices.mobile }} 人 · 电脑 {{ data.devices.desktop }} 人</p>
        </div>
      </section>

      <section class="row two">
        <div class="a-card">
          <div class="a-card-head"><h2>每日访客</h2><span class="aside">按你所在的时区分天</span></div>
          <div class="a-card-body">
            <AdminBarChart :data="chart" :series="[{ name: '访客', color: 'var(--c-brand-solid)' }]" unit=" 人" />
          </div>
        </div>
        <div class="a-card">
          <div class="a-card-head"><h2>转化漏斗</h2><span class="aside">{{ days }} 天</span></div>
          <ol class="a-card-body funnel">
            <li v-for="(f, i) in data.funnel" :key="f.label">
              <div class="funnel-row">
                <span>{{ f.label }}</span>
                <span class="a-num">{{ f.value }}<small v-if="i">{{ pct(f.value, data.funnel[i - 1]!.value) }}</small></span>
              </div>
              <span class="bar"><i :style="{ width: `${(f.value / funnelMax) * 100}%` }" /></span>
            </li>
          </ol>
        </div>
      </section>

      <section class="row two">
        <div class="a-card">
          <div class="a-card-head"><h2>热门页面</h2><span class="aside">浏览最多的 10 个</span></div>
          <table v-if="data.topPages.length" class="list">
            <thead><tr><th>页面</th><th class="n">浏览</th><th class="n">访客</th></tr></thead>
            <tbody>
              <tr v-for="p in data.topPages" :key="p.path">
                <td>
                  <a :href="p.path" target="_blank" rel="noopener" class="page-title"><RichTitle :title="p.title" /></a>
                  <span class="page-path a-mono">{{ p.path }}</span>
                </td>
                <td class="n a-num">{{ p.views }}</td>
                <td class="n a-num">{{ p.visitors }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="a-empty">还没有访问记录</p>
        </div>
        <div class="a-card">
          <div class="a-card-head"><h2>来源</h2><span class="aside">一次访问的第一页从哪来</span></div>
          <ul v-if="data.referrers.length" class="a-card-body refs">
            <li v-for="r in data.referrers" :key="r.host ?? ''">
              <div class="funnel-row">
                <span>{{ r.host ?? '直接打开 / 未知' }}</span>
                <span class="a-num">{{ r.visitors }}</span>
              </div>
              <span class="bar soft"><i :style="{ width: `${(r.visitors / refMax) * 100}%` }" /></span>
            </li>
          </ul>
          <p v-else class="a-empty">还没有访问记录</p>
          <template v-if="data.utmSources.length">
            <div class="a-card-head sub"><h2>推广渠道</h2><span class="aside">链接带 ?utm_source=… 时记录</span></div>
            <ul class="a-card-body utm">
              <li v-for="u in data.utmSources" :key="u.source"><span class="a-code">{{ u.source }}</span><span class="a-num">{{ u.visitors }} 人</span></li>
            </ul>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  transition: opacity var(--dur) var(--ease);
}

.dim {
  opacity: 0.6;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 120px;
  padding: 16px 18px;
}

.kpi-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  color: var(--c-text-2);
}

.kpi-value {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 6px 0 0;
  font-size: 34px;
  font-weight: 700;
  line-height: 1.15;
}

.kpi-value small {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-3);
}

.kpi-sub {
  margin: auto 0 0;
  padding-top: 8px;
  font-size: 12.5px;
  color: var(--c-text-3);
}

.row {
  display: grid;
  gap: 16px;
  margin-top: 16px;
}

.row.two {
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
}

.aside {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.funnel,
.refs {
  display: grid;
  gap: 14px;
  margin: 0;
  list-style: none;
}

.funnel-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13.5px;
}

.funnel-row .a-num {
  font-weight: 600;
}

.funnel-row small {
  margin-left: 8px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-3);
}

.bar {
  display: block;
  height: 8px;
  margin-top: 6px;
  border-radius: var(--r-full);
  background: var(--c-bg-mute);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--c-brand-solid);
}

.bar.soft i {
  background: color-mix(in srgb, var(--c-brand) 45%, var(--c-bg-mute));
}

.list {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}

.list th {
  padding: 8px 16px;
  border-bottom: 1px solid var(--c-divider);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  color: var(--c-text-3);
}

.list td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--c-divider);
  vertical-align: top;
}

.list tr:last-child td {
  border-bottom: 0;
}

.list .n {
  width: 64px;
  text-align: right;
}

.page-title {
  display: block;
  color: var(--c-text-1);
}

.page-title:hover {
  color: var(--c-brand);
}

.page-path {
  font-size: 12px;
  color: var(--c-text-3);
  overflow-wrap: anywhere;
}

.a-card-head.sub {
  border-top: 1px solid var(--c-divider);
}

.utm {
  display: grid;
  gap: 8px;
  margin: 0;
  list-style: none;
  font-size: 13.5px;
}

.utm li {
  display: flex;
  justify-content: space-between;
}

@media (max-width: 1100px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .row.two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
