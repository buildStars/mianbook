import type { ReviewSummary } from '#shared/types/handbook'

/**
 * 复习概况（今日待复习、连续天数等），登录后才有。
 * 按浏览器所在时区计算"今天"，所以只在浏览器端加载
 */
export function useReview() {
  const { loggedIn } = useUserSession()
  const summary = useState<ReviewSummary | null>('review-summary', () => null)

  async function refresh() {
    if (import.meta.server) return
    if (!loggedIn.value) {
      summary.value = null
      return
    }
    try {
      summary.value = await $fetch<ReviewSummary>('/api/review/summary', { query: { tz: new Date().getTimezoneOffset() } })
    } catch {
      // 统计加载失败不影响刷题
    }
  }

  return { summary, refresh }
}
