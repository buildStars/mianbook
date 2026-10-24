// 搜索引擎抓取规则：接口和 MCP 不抓；个人页面、后台由响应头 X-Robots-Tag 控制不收录（见 nuxt.config.ts 的 routeRules）
export default defineEventHandler((event) => {
  const siteUrl = useRuntimeConfig().public.siteUrl
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=86400')
  return ['User-agent: *', 'Disallow: /api/', 'Disallow: /mcp', 'Disallow: /admin', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n')
})
