/** 接口请求带着登录 Cookie 时，比对会话版本：密码改过（或用户已删除）的旧会话直接清掉，后面的接口按未登录处理 */
export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/')) return
  const cookieName = String(useRuntimeConfig(event).session?.name || 'nuxt-session')
  if (!getCookie(event, cookieName)) return
  const session = await getUserSession(event)
  if (!session.user) return
  const current = await sessionVersionOf(session.user.id)
  if (current !== null && (session.secure?.sessionVersion ?? 0) === current) return

  await clearUserSession(event)
  // clearUserSession 只让浏览器删掉 Cookie；这个请求后面的接口还会从请求头里读到旧会话，所以也从请求头里去掉
  event.node.req.headers.cookie = (event.node.req.headers.cookie ?? '')
    .split(/;\s*/)
    .filter((part) => part && !part.startsWith(`${cookieName}=`))
    .join('; ')
})
