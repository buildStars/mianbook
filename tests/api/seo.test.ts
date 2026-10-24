import { describe, expect, it } from 'vitest'
import { baseUrl } from './helpers'

const SITE = 'https://mianbook.ink'

describe('搜索引擎和分享卡片', () => {
  it('robots.txt 挡住接口和后台，并指向 sitemap', async () => {
    const res = await fetch(`${baseUrl()}/robots.txt`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    expect(text).toContain('Disallow: /api/')
    expect(text).toContain('Disallow: /admin')
    expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`)
  })

  it('sitemap.xml 列出首页、功能入口和全部已发布题目', async () => {
    const outline = await (await fetch(`${baseUrl()}/api/outline`)).json()
    const paths: string[] = outline.flatMap((p: any) => p.categories.flatMap((c: any) => c.questions.map((q: any) => q.path)))
    const res = await fetch(`${baseUrl()}/sitemap.xml`)
    expect(res.headers.get('content-type')).toContain('application/xml')
    const xml = await res.text()
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.slice(0, 3)).toEqual([`${SITE}/`, `${SITE}/mock`, `${SITE}/ask`])
    expect(locs.slice(3)).toEqual(paths.map((p) => SITE + p))
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/)
  })

  it('题目页有自己的标题、描述、canonical 和分享卡片', async () => {
    const outline = await (await fetch(`${baseUrl()}/api/outline`)).json()
    const q = outline[0].categories[0].questions[0]
    const cat = outline[0].categories[0].title
    const html = await (await fetch(baseUrl() + q.path)).text()
    const meta = (attr: string, name: string) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1]

    expect(html).toMatch(new RegExp(`<title>[^<]*${cat}[^<]*面试题 \\| 面书</title>`))
    expect(html).toContain(`<link rel="canonical" href="${SITE}${q.path}">`)
    const description = meta('name', 'description')!
    expect(description.length).toBeGreaterThan(30)
    expect(description).not.toContain('前端、后端、AI 应用高频面试题详解') // 不是站点默认描述
    expect(meta('property', 'og:description')).toBe(description)
    expect(meta('property', 'og:type')).toBe('article')
    expect(meta('property', 'og:image')).toBe(`${SITE}/og.png`)
    expect(meta('property', 'og:url')).toBe(`${SITE}${q.path}`)
    expect(meta('name', 'twitter:card')).toBe('summary_large_image')
  })

  it('个人页面和后台不收录，题目页、首页和功能介绍页可以收录', async () => {
    const robots = async (p: string) => (await fetch(baseUrl() + p, { redirect: 'manual' })).headers.get('x-robots-tag')
    for (const p of ['/progress', '/review', '/report', '/connect', '/login', '/admin', '/mock/1', '/mock/agent/1']) {
      expect(await robots(p), p).toBe('noindex')
    }
    for (const p of ['/', '/mock', '/ask']) expect(await robots(p), p).toBeNull()
  })

  it('图标、manifest 和分享图片都能访问', async () => {
    for (const [p, type] of [
      ['/favicon.ico', 'image/'],
      ['/favicon.svg', 'image/svg+xml'],
      ['/apple-touch-icon.png', 'image/png'],
      ['/og.png', 'image/png'],
      ['/manifest.webmanifest', 'application/manifest+json'],
    ]) {
      const res = await fetch(baseUrl() + p)
      expect(res.status, p).toBe(200)
      expect(res.headers.get('content-type'), p).toContain(type)
    }
  })
})
