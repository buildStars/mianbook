import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { baseUrl } from './helpers'

const SITE = 'https://mianbook.ink'

const meta = (html: string, attr: string, name: string) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1]
/** 页面里的文字是 HTML 转义过的，和 JSON-LD 比较前还原 */
const unescapeHtml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
/** 页面里所有 JSON-LD 的原文 */
const jsonLdScripts = (html: string) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!)
const jsonLd = (html: string): any[] => jsonLdScripts(html).flatMap((s) => JSON.parse(s))
const page = async (p: string) => (await fetch(baseUrl() + p)).text()

/** 原样发出请求路径：fetch 会把反斜杠当成斜杠，测不了 /\evil.com/ 这种地址 */
const rawGet = (path: string) =>
  new Promise<{ status: number; location?: string }>((resolve, reject) => {
    const { hostname, port } = new URL(baseUrl())
    http
      .get({ hostname, port, path, headers: { Accept: 'text/html' } }, (res) => {
        res.resume()
        resolve({ status: res.statusCode!, location: res.headers.location })
      })
      .on('error', reject)
  })

describe('搜索引擎和分享卡片', () => {
  it('robots.txt 挡住接口和后台（目录接口除外），并指向 sitemap', async () => {
    const res = await fetch(`${baseUrl()}/robots.txt`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    expect(text).toContain('Disallow: /api/')
    expect(text).toContain('Disallow: /admin')
    expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`)
    // 按顺序取第一条匹配规则的爬虫也要能抓目录接口
    expect(text.indexOf('Allow: /api/outline')).toBeGreaterThan(-1)
    expect(text.indexOf('Allow: /api/outline')).toBeLessThan(text.indexOf('Disallow: /api/'))
  })

  it('sitemap.xml 列出首页、功能入口、分类专题页、全部已发布题目和默写练习', async () => {
    const outline = await (await fetch(`${baseUrl()}/api/outline`)).json()
    const practice: { path: string }[] = await (await fetch(`${baseUrl()}/api/practice`)).json()
    // 每个分类专题页排在它的题目前面
    const paths: string[] = outline.flatMap((p: any) =>
      p.categories.flatMap((c: any) => [`/${p.slug}/${c.slug}`, ...c.questions.map((q: any) => q.path)]),
    )
    const res = await fetch(`${baseUrl()}/sitemap.xml`)
    expect(res.headers.get('content-type')).toContain('application/xml')
    const xml = await res.text()
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.slice(0, 3)).toEqual([`${SITE}/`, `${SITE}/mock`, `${SITE}/ask`])
    const practicePaths = practice.length ? ['/practice', ...practice.map((p) => `/practice${p.path}`)] : []
    expect(locs.slice(3)).toEqual([...paths, ...practicePaths].map((p) => SITE + p))
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/)
  })

  it('题目页有自己的标题、描述、canonical 和分享卡片', async () => {
    const outline = await (await fetch(`${baseUrl()}/api/outline`)).json()
    const q = outline[0].categories[0].questions[0]
    const cat = outline[0].categories[0].title
    const html = await page(q.path)

    expect(html).toMatch(new RegExp(`<title>[^<]*${cat}[^<]*面试题 \\| 面书</title>`))
    expect(html).toContain(`<link rel="canonical" href="${SITE}${q.path}">`)
    const description = meta(html, 'name', 'description')!
    expect(description.length).toBeGreaterThan(30)
    expect(description).not.toContain('前端、后端、AI 应用高频面试题详解') // 不是站点默认描述
    expect(meta(html, 'property', 'og:description')).toBe(description)
    expect(meta(html, 'property', 'og:type')).toBe('article')
    expect(meta(html, 'property', 'og:image')).toBe(`${SITE}/og.png`)
    expect(meta(html, 'property', 'og:url')).toBe(`${SITE}${q.path}`)
    expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image')
  })

  it('问手册和模拟面试有自己的标题和描述', async () => {
    for (const p of ['/ask', '/mock']) {
      const html = await page(p)
      const description = meta(html, 'name', 'description')!
      expect(description, p).not.toContain('前端、后端、AI 应用高频面试题详解')
      expect(meta(html, 'property', 'og:description'), p).toBe(description)
      expect(html, p).toMatch(/<title>[^<]*AI[^<]* \| 面书<\/title>/)
    }
  })

  it('首页、分类专题页和题目页有结构化数据，面包屑经过分类专题页', async () => {
    const outline = await (await fetch(`${baseUrl()}/api/outline`)).json()
    const part = outline[0]
    const cat = part.categories[0]
    const q = cat.questions[0]
    const catUrl = `${SITE}/${part.slug}/${cat.slug}`

    const home = jsonLd(await page('/'))
    expect(home.map((o) => o['@type'])).toEqual(['WebSite', 'Organization'])
    expect(home[0]).toMatchObject({ name: '面书', url: `${SITE}/` })

    const category = jsonLd(await page(`/${part.slug}/${cat.slug}`))
    expect(category.map((o) => o['@type'])).toEqual(['BreadcrumbList', 'ItemList'])
    expect(category[1].numberOfItems).toBe(cat.questions.length)
    expect(category[1].itemListElement[0].url).toBe(SITE + q.path)

    const html = await page(q.path)
    const [crumbs, article] = jsonLd(html)
    expect(crumbs['@type']).toBe('BreadcrumbList')
    expect(crumbs.itemListElement.map((i: any) => i.item)).toEqual([`${SITE}/`, catUrl, SITE + q.path])
    expect(article).toMatchObject({ '@type': 'TechArticle', url: SITE + q.path, inLanguage: 'zh-CN', publisher: { name: '面书' } })
    expect(article.description).toBe(unescapeHtml(meta(html, 'name', 'description')!))
    expect(Number.isNaN(Date.parse(article.dateModified))).toBe(false)
    // 标题是纯文本：和 <title> 开头一致，不带 Markdown 的反引号
    expect(unescapeHtml(html.match(/<title>([^<]*)<\/title>/)![1]!).startsWith(`${article.headline} · `)).toBe(true)
  })

  it('JSON-LD 里的 < 被转义，题目里的 <script setup> 不会提前结束脚本', async () => {
    const outline = await (await fetch(`${baseUrl()}/api/outline`)).json()
    const q = outline.flatMap((p: any) => p.categories.flatMap((c: any) => c.questions)).find((x: any) => x.title.includes('<script'))
    expect(q).toBeDefined()
    const scripts = jsonLdScripts(await page(q.path))
    expect(scripts.join('')).not.toContain('<')
    expect(JSON.parse(scripts[0]!)[1].headline).toContain('<script setup>')
  })

  it('结尾带斜杠的页面地址 301 到不带斜杠的版本，查询参数保留', async () => {
    const outline = await (await fetch(`${baseUrl()}/api/outline`)).json()
    const catPath = `/${outline[0].slug}/${outline[0].categories[0].slug}`
    const q = outline[0].categories[0].questions[0].path
    expect(await rawGet(`${catPath}/`)).toEqual({ status: 301, location: catPath })
    expect(await rawGet(`${q}//?from=share&x=1`)).toEqual({ status: 301, location: `${q}?from=share&x=1` })
    // 接口不跳
    expect((await rawGet('/api/outline/')).status).not.toBe(301)
  })

  it('去掉结尾斜杠后会被浏览器当成别的网站的地址，一律不跳', async () => {
    for (const p of ['//evil.com/', '///evil.com/', '/\\evil.com/', '/\\/evil.com/']) {
      const res = await rawGet(p)
      expect(res.status, p).not.toBe(301)
      expect(res.location ?? '', p).not.toMatch(/^[/\\]{2}/)
    }
  })

  it('不存在的题目返回 404，标题说明没有找到', async () => {
    const outline = await (await fetch(`${baseUrl()}/api/outline`)).json()
    const res = await fetch(`${baseUrl()}/${outline[0].slug}/${outline[0].categories[0].slug}/no-such-question`, { headers: { Accept: 'text/html' } })
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('<title>这一页没有找到 | 面书</title>')
  })

  it('站长平台验证标签配置了才输出；百度适配标签每页都有', async () => {
    // 测试服务配置了谷歌的验证码（见 global-setup.ts），必应和百度的没配
    const html = await page('/')
    expect(meta(html, 'name', 'google-site-verification')).toBe('test-google-verification')
    expect(html).not.toContain('msvalidate.01')
    expect(html).not.toContain('baidu-site-verification')
    expect(meta(html, 'name', 'applicable-device')).toBe('pc,mobile')
    expect(html).toContain('<meta http-equiv="Cache-Control" content="no-transform">')
    expect(html).toContain('<meta http-equiv="Cache-Control" content="no-siteapp">')
  })

  it('个人页面、后台和接口不收录，题目页、首页和功能介绍页可以收录', async () => {
    const robots = async (p: string) => (await fetch(baseUrl() + p, { redirect: 'manual' })).headers.get('x-robots-tag')
    for (const p of ['/progress', '/review', '/report', '/connect', '/login', '/admin', '/mock/1', '/mock/agent/1', '/api/outline']) {
      expect(await robots(p), p).toBe('noindex')
    }
    for (const p of ['/', '/mock', '/ask']) expect(await robots(p), p).toBeNull()
  })

  it('目录不进页面 payload：按版本号单独请求，当前版本永久缓存', async () => {
    const res = await fetch(`${baseUrl()}/api/outline`)
    const version = res.headers.get('x-outline-version')!
    expect(version).toMatch(/^[0-9a-f]{12}$/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const cached = await fetch(`${baseUrl()}/api/outline?v=${version}`)
    expect(cached.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await cached.json()).toEqual(await res.json())
    expect((await fetch(`${baseUrl()}/api/outline?v=000000000000`)).headers.get('cache-control')).toBe('no-store')

    const outline = await (await fetch(`${baseUrl()}/api/outline`)).json()
    const cat = outline[0].categories[0]
    const html = await (await fetch(baseUrl() + cat.questions[0].path)).text()
    expect(html).toContain(`<link rel="preload" as="fetch" href="/api/outline?v=${version}" crossorigin="anonymous">`)
    const payload = html.match(/<script type="application\/json"[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)![1]!
    // 其他分类的题目标题不在 payload 里
    const otherTitle = outline.at(-1).categories.at(-1).questions.at(-1).title
    expect(payload).not.toContain(otherTitle)
    // 侧栏只渲染当前分类的题目
    const sidebar = html.match(/<aside[^>]*class="sidebar"[\s\S]*?<\/aside>/)![0]
    expect(sidebar.match(/<a [^>]*href="\/[^"]+\/[^"]+\/[^"]+"/g)).toHaveLength(cat.questions.length)

    const home = await (await fetch(`${baseUrl()}/`)).text()
    const homePayload = home.match(/<script type="application\/json"[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)![1]!
    expect(homePayload.length).toBeLessThan(5000)
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
