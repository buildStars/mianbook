import { describe, expect, it } from 'vitest'
import { cleanUtmSource, createMinuteLimiter, isBotUserAgent, referrerHostOf, trackablePath } from '../../server/utils/traffic-core'

describe('访问统计：来源、爬虫和限频', () => {
  it('只留外站域名；本站（带不带 www）、解析不了的都算没有来源', () => {
    const site = ['mianbook.ink', 'localhost']
    expect(referrerHostOf('https://www.google.com/search?q=闭包', site)).toBe('www.google.com')
    expect(referrerHostOf('https://juejin.cn/post/123', site)).toBe('juejin.cn')
    expect(referrerHostOf('https://mianbook.ink/basics/x', site)).toBeNull()
    expect(referrerHostOf('https://www.mianbook.ink/', site)).toBeNull()
    expect(referrerHostOf('http://localhost:3000/', site)).toBeNull()
    expect(referrerHostOf('not a url', site)).toBeNull()
    expect(referrerHostOf(undefined, site)).toBeNull()
  })

  it('utm_source 只留安全字符', () => {
    expect(cleanUtmSource(' V2EX ')).toBe('v2ex')
    expect(cleanUtmSource('wechat_group-1')).toBe('wechat_group-1')
    expect(cleanUtmSource('<script>')).toBe('script')
    expect(cleanUtmSource('中文')).toBeNull()
    expect(cleanUtmSource('x'.repeat(100))).toHaveLength(64)
  })

  it('识别爬虫和脚本请求，正常浏览器不算', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Baiduspider/2.0)')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/140.0 Safari/537.36')).toBe(true)
    expect(isBotUserAgent('curl/8.5.0')).toBe(true)
    expect(isBotUserAgent('')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50')).toBe(false)
    expect(isBotUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36')).toBe(false)
  })

  it('路径去掉参数和锚点，后台和接口不记', () => {
    expect(trackablePath('/basics/js/01?utm_source=x#a')).toBe('/basics/js/01')
    expect(trackablePath('/')).toBe('/')
    expect(trackablePath('/admin')).toBeNull()
    expect(trackablePath('/admin/users')).toBeNull()
    expect(trackablePath('/api/pv')).toBeNull()
    expect(trackablePath('/administrator-guide')).toBe('/administrator-guide')
    expect(trackablePath('https://evil.example/')).toBeNull()
  })

  it('同一个 key 每分钟最多 limit 次，下一分钟重新计数', () => {
    const allow = createMinuteLimiter(2)
    const t = 1_000_000 * 60_000
    expect([allow('a', t), allow('a', t + 1), allow('a', t + 2), allow('b', t + 3)]).toEqual([true, true, false, true])
    expect(allow('a', t + 60_000)).toBe(true)
  })
})
