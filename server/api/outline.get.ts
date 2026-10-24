/**
 * 全站目录。响应头 X-Outline-Version 是内容版本：
 * 带上当前版本（?v=…）请求时永久缓存（版本变了地址就变）；不带或版本已过期时不缓存
 */
export default defineEventHandler(async (event) => {
  const [outline, version] = await Promise.all([getOutline(), getOutlineVersion()])
  setResponseHeader(event, 'X-Outline-Version', version)
  setResponseHeader(
    event,
    'Cache-Control',
    getQuery(event).v === version ? 'public, max-age=31536000, immutable' : 'no-store',
  )
  return outline
})
