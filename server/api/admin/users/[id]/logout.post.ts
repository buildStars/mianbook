/** 让这个用户在所有设备上下线：会话版本加 1，旧的登录 Cookie 全部失效。访问令牌不受影响，要停用令牌请单独撤销 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = idParam(event)
  if (id === admin.id) throw createError({ statusCode: 400, message: '不能让自己下线，请直接退出登录' })
  await adminTargetUser(id)
  await revokeUserSessions(id)
  return { ok: true }
})
