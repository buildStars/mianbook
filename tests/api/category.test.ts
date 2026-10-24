import { beforeAll, describe, expect, it } from 'vitest'
import { Client, baseUrl, db } from './helpers'

const SITE = 'https://mianbook.ink'
let outline: any[]
const catOf = (partSlug: string, catSlug: string) => {
  const part = outline.find((p) => p.slug === partSlug)
  return { part, cat: part.categories.find((c: any) => c.slug === catSlug) }
}

beforeAll(async () => {
  outline = await (await fetch(`${baseUrl()}/api/outline`)).json()
})

describe('分类专题页', () => {
  it('接口返回分类下全部题目（带一句话回答）和同一部分的其他分类', async () => {
    const { part, cat } = catOf('basics', 'javascript')
    const res = await fetch(`${baseUrl()}/api/categories/basics/javascript`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.category).toMatchObject({ id: cat.id, slug: 'javascript', title: 'JavaScript' })
    expect(data.questions.map((q: any) => q.path)).toEqual(cat.questions.map((q: any) => q.path))
    expect(data.questions[0].summary.length).toBeGreaterThan(30)
    expect(data.questions[0].tags).toBeInstanceOf(Array)
    expect(data.siblings).toHaveLength(part.categories.length - 1)
    expect(data.siblings.some((s: any) => s.path === '/basics/javascript')).toBe(false)
    expect((await fetch(`${baseUrl()}/api/categories/basics/no-such`)).status).toBe(404)
  })

  it('页面有自己的标题、描述、canonical 和结构化数据，题目都能点进去', async () => {
    const { cat } = catOf('basics', 'javascript')
    const n = cat.questions.length
    const res = await fetch(`${baseUrl()}/basics/javascript`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain(`<title>JavaScript 面试题（${n} 道） | 面书</title>`)
    expect(html).toMatch(new RegExp(`<meta name="description" content="${n} 道 JavaScript 面试题：`))
    expect(html).toContain(`<link rel="canonical" href="${SITE}/basics/javascript">`)
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)![1]!)
    expect(ld[1]).toMatchObject({ '@type': 'ItemList', numberOfItems: n })
    expect(ld[1].itemListElement[0].url).toBe(SITE + cat.questions[0].path)
    for (const q of cat.questions) expect(html).toContain(`href="${q.path}"`)
    expect(html).toContain(`/mock?categories=${cat.id}`)
  })

  it('分类名本身带"题"时不重复加"面试题"；不存在的分类是 404', async () => {
    const { cat } = catOf('basics', 'handwriting')
    const html = await (await fetch(`${baseUrl()}/basics/handwriting`)).text()
    expect(html).toContain(`<title>前端手写题（${cat.questions.length} 道） | 面书</title>`)
    expect((await fetch(`${baseUrl()}/basics/no-such-category`)).status).toBe(404)
  })

  it('题目页的面包屑和首页目录指向分类专题页', async () => {
    const q = await (await fetch(`${baseUrl()}/basics/javascript/02-closure`)).text()
    expect(q).toMatch(/<nav class="crumbs"[\s\S]*?href="\/basics\/javascript"/)
    const home = await (await fetch(`${baseUrl()}/`)).text()
    expect(home).toContain('href="/basics/javascript" class="cat"')
  })
})

describe('相关题目', () => {
  // 相关题目靠问手册的检索索引，服务刚启动时还在后台同步：先用管理员手动同步一次，等它完成
  beforeAll(async () => {
    const c = new Client()
    const u = await c.register('relatedadmin')
    await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [u.id])
    expect((await c.json('/api/admin/rag/sync', { method: 'POST' })).status).toBe(200)
  })

  it('题目页底部推荐 6 道：不含自己和上一题、下一题，同分类最多 2 道，跨分类找到 Node.js 事件循环', async () => {
    const detail = await (await fetch(`${baseUrl()}/api/questions/basics/javascript/01-event-loop`)).json()
    const related: any[] = detail.related
    expect(related).toHaveLength(6)
    const paths = new Set(outline.flatMap((p) => p.categories.flatMap((c: any) => c.questions.map((x: any) => x.path))))
    for (const r of related) expect(paths.has(r.path)).toBe(true)
    expect(new Set(related.map((r) => r.id)).size).toBe(6)
    expect(related.map((r) => r.id)).not.toContain(detail.id)
    const neighbours = [detail.prev, detail.next].filter(Boolean).map((l: any) => l.path)
    for (const r of related) expect(neighbours).not.toContain(r.path)
    expect(related.filter((r) => r.category === 'JavaScript').length).toBeLessThanOrEqual(2)
    expect(related.some((r) => r.path === '/basics/node/01-event-loop')).toBe(true)

    const html = await (await fetch(`${baseUrl()}/basics/javascript/01-event-loop`)).text()
    expect(html).toContain('相关题目')
    for (const r of related) expect(html).toContain(`href="${r.path}"`)
  })
})
