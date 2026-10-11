/** 管理后台用到的接口类型 */

export type AiKind = 'interview' | 'report' | 'resume'

export interface DashboardQuestionRef {
  id: number
  title: string
  /** 前台网址；题目是草稿时也给出，后台可以预览 */
  path: string
  status: 'draft' | 'published'
}

export interface AdminDashboard {
  /** 最近 14 天的本地日期，从早到晚 */
  days: string[]
  ai: {
    configured: boolean
    model: string
    /** 每天的调用次数：site 用站点 Key，own 用户自己的 Key；token 只统计站点 Key */
    daily: { date: string; site: number; own: number; promptTokens: number; completionTokens: number }[]
    byKind: { kind: AiKind; site: number; own: number }[]
    /** 最近 7 天和再往前 7 天用站点 Key 的调用次数，用来算环比 */
    site7d: number
    sitePrev7d: number
    own14d: number
    promptTokens: number
    completionTokens: number
    /** 服务商没返回 token 用量的调用次数，这部分不计入费用 */
    untracked: number
    /** 按后台设置的价格估算的站点 Key 费用（14 天）；没设置价格时为 null */
    cost: { amount: number; currency: 'CNY' | 'USD' } | null
  }
  activity: {
    daily: { date: string; active: number; newUsers: number }[]
    dau: number
    wau: number
    mau: number
    users: number
    newUsers7d: number
  }
  /** 最近 7 天的学习数据 */
  learning: {
    reads: number
    readSeconds: number
    reviews: number
    interviews: number
    interviewAvg: number | null
    mockStarted: number
    mockFinished: number
    mockAvg: number | null
  }
  content: {
    total: number
    published: number
    drafts: number
    categories: number
    recent: (DashboardQuestionRef & { updatedAt: string })[]
  }
  board: {
    /** AI 面试第一轮平均分最低的题（至少 2 次面试） */
    lowScore: (DashboardQuestionRef & { avg: number; count: number })[]
    /** 最近 30 天复习时被标"不会"最多的题 */
    forgotten: (DashboardQuestionRef & { count: number; users: number })[]
    /** 最近 30 天阅读人数最多的题 */
    popular: (DashboardQuestionRef & { users: number; seconds: number })[]
  }
  /** 需要处理的事项 */
  alerts: { level: 'warn' | 'info'; text: string; to?: string; action?: string }[]
}

export interface QuestionVersionSummary {
  id: number
  title: string
  difficulty: number
  tags: string[]
  status: 'draft' | 'published'
  /** 保存这个版本的管理员；命令行导入等外部修改为 null */
  editor: string | null
  createdAt: string
  /** 和上一个版本相比增删的行数；最早的版本为 null */
  added: number | null
  removed: number | null
  /** 是否和题目当前的内容一样 */
  current: boolean
}

export interface QuestionVersionDetail {
  id: number
  title: string
  difficulty: number
  tags: string[]
  status: 'draft' | 'published'
  contentMd: string
  editor: string | null
  createdAt: string
}

export interface AdminAiSettings {
  baseUrl: string
  keyConfigured: boolean
  model: string
  dailyLimit: number
  extraHosts: string[]
  allowUserKey: boolean
  pricing: { input: number; output: number; currency: 'CNY' | 'USD' } | null
  defaults: { model: string; dailyLimit: number; extraHosts: string[] }
  overridden: Record<string, unknown>
}
