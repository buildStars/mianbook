// 搜索引擎抓取规则：接口和 MCP 不抓；个人页面、后台由响应头 X-Robots-Tag 控制不收录（见 nuxt.config.ts 的 routeRules）。
// 目录接口例外：页面在浏览器里渲染导航要用它，挡住的话搜索引擎渲染出的页面会缺导航。
// Allow 写在 Disallow 前面：谷歌、必应按最长匹配，按顺序取第一条的爬虫也能读对
export default defineEventHandler((event) => {
  const siteUrl = useRuntimeConfig().public.siteUrl
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=86400')
  return [
    'User-agent: *',
    'Allow: /api/outline',
    'Disallow: /api/',
    'Disallow: /mcp',
    'Disallow: /admin',
    'Disallow: /sandbox/',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n')
})
