import { lt } from 'drizzle-orm'

const DAY = 86_400_000

/** 页面访问记录只保留一年：服务启动一分钟后删一次过期的，之后每天一次 */
export default defineNitroPlugin(() => {
  const prune = () =>
    useDb()
      .delete(tables.pageViews)
      .where(lt(tables.pageViews.createdAt, new Date(Date.now() - 365 * DAY)))
      .catch((error) => console.error('清理过期的访问记录失败', error))
  setTimeout(prune, 60_000).unref()
  setInterval(prune, DAY).unref()
})
