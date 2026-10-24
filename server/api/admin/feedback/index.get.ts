// 显式导入：写成 (FEEDBACK_STATUSES as …) 时 Nitro 的自动导入扫描不到，构建后会是未定义
import { FEEDBACK_STATUSES, type FeedbackStatus } from '#shared/utils/feedback'

/** 后台反馈列表：?status=open|resolved|ignored，不传就是全部 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const status = String(getQuery(event).status ?? '')
  return adminFeedbackRows((FEEDBACK_STATUSES as readonly string[]).includes(status) ? (status as FeedbackStatus) : undefined)
})
