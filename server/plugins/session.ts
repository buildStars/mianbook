import { eq } from 'drizzle-orm'

/**
 * 会话保存在加密 cookie 里，本身不查数据库。每次前端获取会话时核对一次：
 * 账号已被删除就清掉会话；昵称、邮箱或角色变了就同步到会话里。
 */
export default defineNitroPlugin(() => {
  sessionHooks.hook('fetch', async (session, event) => {
    if (!session.user) return
    const [row] = await useDb()
      .select({ id: tables.users.id, name: tables.users.name, email: tables.users.email, role: tables.users.role })
      .from(tables.users)
      .where(eq(tables.users.id, session.user.id))

    if (!row) {
      await clearUserSession(event)
      delete session.user
      return
    }
    const { name, email, role } = session.user
    if (row.name !== name || row.email !== email || row.role !== role) {
      session.user = row
      await replaceUserSession(event, { user: row })
    }
  })
})
