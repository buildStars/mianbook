/** 后台的数字和时间格式 */

/** 相对时间：刚刚、5 分钟前、3 小时前、昨天、4 天前，再早就显示日期 */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (now - new Date(iso).getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86_400) return `${Math.floor(diff / 3600)} 小时前`
  const days = Math.floor(diff / 86_400)
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  const d = new Date(iso)
  return d.getFullYear() === new Date(now).getFullYear()
    ? `${d.getMonth() + 1} 月 ${d.getDate()} 日`
    : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 完整的本地时间，用在 title 提示里 */
export const formatDateTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false })

/** 大数字用"万"：8,520、12.3 万 */
export function compactNumber(n: number): string {
  if (n < 10_000) return n.toLocaleString('zh-CN')
  if (n < 100_000_000) return `${(n / 10_000).toFixed(n < 100_000 ? 1 : 0)} 万`
  return `${(n / 100_000_000).toFixed(1)} 亿`
}

/** 时长：35 分钟、2.5 小时 */
export function formatSeconds(seconds: number): string {
  if (!seconds) return '0 分钟'
  const m = seconds / 60
  if (m < 1) return '不到 1 分钟'
  if (m < 60) return `${Math.round(m)} 分钟`
  return `${(m / 60).toFixed(m < 600 ? 1 : 0)} 小时`
}

/** 耗时：850ms、2.3s；没有数据时显示 — */
export const formatMs = (v: number | null) => (v === null ? '—' : v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(1)}s`)

/** 金额：¥12.30、$0.05；不到一分钱时不显示成 0 */
export function formatMoney(c: { amount: number; currency: 'CNY' | 'USD' }): string {
  const symbol = c.currency === 'CNY' ? '¥' : '$'
  return c.amount > 0 && c.amount < 0.01 ? `不到 ${symbol}0.01` : `${symbol}${c.amount.toFixed(2)}`
}
