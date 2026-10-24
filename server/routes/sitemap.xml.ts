import { eq } from 'drizzle-orm'

/** 站点地图：首页、功能入口和全部已发布的题目，题目带最后修改时间 */
export default defineEventHandler(async (event) => {
  const siteUrl = useRuntimeConfig().public.siteUrl
  const [outline, rows] = await Promise.all([
    getOutline(),
    useDb()
      .select({ id: tables.questions.id, updatedAt: tables.questions.updatedAt })
      .from(tables.questions)
      .where(eq(tables.questions.status, 'published')),
  ])
  const updated = new Map(rows.map((r) => [r.id, r.updatedAt.toISOString().slice(0, 10)]))

  const urls: { loc: string; lastmod?: string }[] = [{ loc: '/' }, { loc: '/mock' }, { loc: '/ask' }]
  for (const part of outline) {
    for (const cat of part.categories) {
      for (const q of cat.questions) urls.push({ loc: q.path, lastmod: updated.get(q.id) })
    }
  }

  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = urls
    .map((u) => `  <url><loc>${escape(siteUrl + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
    .join('\n')

  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
})
