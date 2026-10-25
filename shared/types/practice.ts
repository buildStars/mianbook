import type { QuestionLink } from './handbook'

/** 练习列表里的一项 */
export interface PracticeSummary {
  /** 对应题目的路径，练习页是 /practice + path */
  path: string
  title: string
  /** 对应题目的标题 */
  questionTitle: string
  questionId: number
  num: number
  difficulty: number
  category: { slug: string; title: string }
}

/** 默写练习页：/practice/basics/handwriting/13-promisify */
export interface PracticeDetail extends PracticeSummary {
  /** 要求（已渲染的 HTML） */
  taskHtml: string
  /** 提示（已渲染的行内 HTML），一条一条展开 */
  hints: string[]
  starter: string
  tests: string
  solution: string
  /** 测试要用 document */
  dom: boolean
  prev: QuestionLink | null
  next: QuestionLink | null
}

/** 每条测试用例的结果，由运行页（/sandbox/runner）发回来 */
export interface PracticeTestResult {
  index: number
  name: string
  ok: boolean
  ms: number
  error: { message: string; line: number | null } | null
}

/** AI 点评代码的 SSE 事件 */
export interface PracticeReviewDoneEvent {
  remaining: number | null
}
