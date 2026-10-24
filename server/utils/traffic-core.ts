// 访问统计里不依赖数据库的部分：识别爬虫、整理来源、限频，单元测试直接引用

const BOT_UA = /bot|spider|crawl|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|python|curl|wget|httpclient|java\/|go-http/i

/** 爬虫、预览抓取、脚本请求；没有 UA 的也算 */
export const isBotUserAgent = (ua: string | undefined | null) => !ua || BOT_UA.test(ua)

/**
 * 外站来源的域名；站内跳转（包括带不带 www）、地址解析不了的返回 null。
 * siteHosts 是本站的域名，比如线上域名和当前请求的 Host
 */
export function referrerHostOf(referrer: string | undefined, siteHosts: string[]): string | null {
  if (!referrer) return null
  let host: string
  try {
    host = new URL(referrer).hostname.toLowerCase()
  } catch {
    return null
  }
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, '')
  if (!host || siteHosts.some((h) => h && bare(h) === bare(host))) return null
  return host.slice(0, 128)
}

/** utm_source 只留小写字母、数字和 . _ -，最多 64 个字符 */
export function cleanUtmSource(value: string | undefined | null): string | null {
  const v = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 64)
  return v || null
}

/** 统计的路径：去掉查询参数和锚点；后台和接口不记 */
export function trackablePath(path: string): string | null {
  const clean = path.split(/[?#]/)[0]!.slice(0, 255)
  if (!clean.startsWith('/') || /^\/(admin|api)(\/|$)/.test(clean)) return null
  return clean
}

/** 固定窗口限频：同一个 key 每分钟最多 limit 次。只在内存里，重启清零，够挡住刷量 */
export function createMinuteLimiter(limit: number) {
  const hits = new Map<string, { minute: number; count: number }>()
  return (key: string, now = Date.now()) => {
    const minute = Math.floor(now / 60_000)
    const hit = hits.get(key)
    if (!hit || hit.minute !== minute) {
      if (hits.size > 10_000) hits.clear()
      hits.set(key, { minute, count: 1 })
      return true
    }
    hit.count++
    return hit.count <= limit
  }
}
