/** 解除登录锁定：清掉这个账号的登录失败记录，所有 IP 都可以马上再试 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const user = await adminTargetUser(idParam(event))
  await clearLoginFailures(user.email)
  return { ok: true }
})
