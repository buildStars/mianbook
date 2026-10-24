/** 管理后台用到的接口类型 */

export type AiKind = 'interview' | 'report' | 'resume' | 'author' | 'ask' | 'agent'

/** 某个功能的 AI 调用性能（近 7 天）；延迟单位毫秒，只统计正常结束的调用 */
export interface AiPerfRow {
  kind: AiKind | 'all'
  calls: number
  errors: number
  aborted: number
  errorRate: number
  ttftP50: number | null
  ttftP95: number | null
  latencyP50: number | null
  latencyP95: number | null
}

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
  /** AI 调用的延迟和出错率（近 7 天） */
  perf: {
    byKind: AiPerfRow[]
    overall: AiPerfRow
    /** 最近几次出错的 AI 调用 */
    recentErrors: { kind: string; model: string | null; error: string; at: string }[]
  }
  /** 服务端 5xx 错误 */
  errors: {
    count7d: number
    recent: { message: string; path: string | null; method: string | null; statusCode: number; at: string }[]
  }
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

/** 后台用户列表的一行 */
export interface AdminUserRow {
  id: number
  email: string
  name: string
  role: 'admin' | 'user'
  createdAt: string
  emailVerified: boolean
  /** 停用的时间；正常的账号为 null */
  disabledAt: string | null
  mastered: number
  interviews: number
  /** 最近 30 天用站点 Key 的调用次数 */
  aiCalls30d: number
  /** 最近 24 小时计入次数的调用，和用户看到的"剩余次数"同一个口径 */
  aiUsed24h: number
  /** 生效的 24 小时上限：单独设过的按单独设的，否则是全站设置 */
  aiLimit: number
  /** 单独设的上限；null 表示跟随全站设置，0 表示不能用站点的 AI */
  aiLimitCustom: number | null
  lastActiveAt: string | null
}

/** 后台用户详情 */
export interface AdminUserDetail {
  user: AdminUserRow
  /** 全站的 24 小时上限，表单里"跟随全站设置"显示用 */
  defaultLimit: number
  /** 站点配置了发信邮箱，才能发重置密码邮件 */
  mailConfigured: boolean
  study: { mastered: number; fuzzy: number; weak: number; starred: number; notes: number; cards: number; due: number }
  practice: { interviews: number; mocks: number; mocksFinished: number; agents: number }
  /** 最近 30 天的 AI 调用 */
  ai: {
    site: number
    own: number
    errors: number
    byKind: { kind: AiKind; site: number; own: number; errors: number }[]
    /** 只统计站点 Key 的 token */
    promptTokens: number
    completionTokens: number
    /** 按后台设置的价格估算的站点 Key 费用；没设置价格时为 null */
    cost: { amount: number; currency: 'CNY' | 'USD' } | null
    recent: {
      id: number
      at: string
      kind: string
      model: string | null
      status: 'ok' | 'aborted' | 'error'
      latencyMs: number | null
      tokens: number | null
      error: string | null
    }[]
  }
  /** 最近一小时的登录失败；被锁的 IP 只算"账号 + IP"这条规则 */
  login: { failures: number; lastFailureAt: string | null; accountLocked: boolean; lockedIps: number }
  tokens: { id: number; name: string; prefix: string; scope: 'read' | 'write'; createdAt: string; lastUsedAt: string | null; expiresAt: string | null }[]
}

/** 后台反馈列表的一行 */
export interface AdminFeedbackRow {
  id: number
  kind: 'error' | 'unclear' | 'outdated' | 'other'
  content: string
  status: 'open' | 'resolved' | 'ignored'
  createdAt: string
  handledAt: string | null
  question: { id: number; title: string; path: string; category: string; published: boolean }
  /** 没登录提交时为空 */
  user: { id: number; name: string; email: string } | null
}

/** 后台"访问"页：自建统计的汇总 */
export interface AdminTraffic {
  /** 统计最近几天（含今天） */
  days: number
  /** 每天的访客、浏览量和注册数，从早到晚 */
  daily: { date: string; visitors: number; views: number; signups: number }[]
  totals: {
    visitors: number
    views: number
    signups: number
    /** 这段时间注册、并且做过 AI 面试（单题、整场或 Agent）的用户 */
    activated: number
    /** 有两天以上来过的访客 */
    returning: number
  }
  /** 访客 → 看过题目 → 注册 → 做过 AI 面试 */
  funnel: { label: string; value: number }[]
  topPages: { path: string; title: string; views: number; visitors: number }[]
  /** 一次访问的第一页从哪来；直接打开或来源未知的 host 为空 */
  referrers: { host: string | null; visitors: number }[]
  utmSources: { source: string; visitors: number }[]
  devices: { mobile: number; desktop: number }
}
