/** 不会 / 模糊 / 掌握 */
export type StudyStatus = 'weak' | 'fuzzy' | 'mastered'

export type UserRole = 'admin' | 'user'

export type QuestionStatus = 'draft' | 'published'

export interface TocItem {
  level: 2 | 3
  id: string
  text: string
}

export interface OutlineQuestion {
  id: number
  /** 全局题号，按目录顺序编号 */
  num: number
  slug: string
  title: string
  difficulty: number
  /** 页面路径，如 /basics/javascript/01-event-loop */
  path: string
}

export interface OutlineCategory {
  id: number
  slug: string
  title: string
  questions: OutlineQuestion[]
}

export interface OutlinePart {
  id: number
  slug: string
  title: string
  categories: OutlineCategory[]
}

export interface QuestionLink {
  title: string
  path: string
}

export interface QuestionDetail {
  id: number
  num: number
  title: string
  difficulty: number
  tags: string[]
  html: string
  toc: TocItem[]
  path: string
  part: { slug: string; title: string }
  category: { slug: string; title: string }
  prev: QuestionLink | null
  next: QuestionLink | null
  updatedAt: string
}

export interface StudyRecord {
  status: StudyStatus | null
  starred: boolean
  note: string | null
  updatedAt: string
}

/** 学习记录按题目 id 索引 */
export type StudyRecordMap = Record<number, StudyRecord>

export interface InterviewTurn {
  /** 用户这一轮的回答 */
  answer: string
  /** AI 的点评（Markdown） */
  feedback: string
  /** 0~10 分，解析失败时为 null */
  score: number | null
  /** 下一轮追问，没有时为 null */
  followUp: string | null
  at: string
}

export interface InterviewSummary {
  id: number
  rounds: number
  score: number | null
  turns: InterviewTurn[]
  createdAt: string
  updatedAt: string
}

export interface SearchHit {
  id: number
  title: string
  path: string
  part: string
  category: string
  snippet: string
}
