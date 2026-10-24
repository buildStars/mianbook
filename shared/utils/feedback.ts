/** 题目纠错和反馈的类型，顺序就是题目页上按钮的顺序 */
export const FEEDBACK_KINDS = ['error', 'unclear', 'outdated', 'other'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  error: '内容有误',
  unclear: '没讲清楚',
  outdated: '已经过时',
  other: '其他',
}

/** 后台处理状态：open 待处理、resolved 已改、ignored 不用改 */
export const FEEDBACK_STATUSES = ['open', 'resolved', 'ignored'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: '待处理',
  resolved: '已处理',
  ignored: '已忽略',
}

/** 反馈内容的字数范围 */
export const FEEDBACK_MIN_LENGTH = 5
export const FEEDBACK_MAX_LENGTH = 1000
