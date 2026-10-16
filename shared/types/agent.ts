/** Agent 面试：AI 面试官自己调用工具查学习记录、搜题、出题、打分 */

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** 带工具调用的对话消息，格式和 OpenAI 的 /chat/completions 一致 */
export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string }

/** 面试过程中问过的每一道题（含追问），存在 agent_sessions.state 里 */
export interface AgentAskedItem {
  questionId: number
  title: string
  category: string
  difficulty: number
  /** 追问的内容；主问题为 null */
  followUp: string | null
  /** 打分后写入 */
  score: number | null
  strengths: string[]
  gaps: string[]
  skipped: boolean
}

export interface AgentState {
  asked: AgentAskedItem[]
  /** 正在问的题在 asked 里的下标；还没出题时为 null */
  current: number | null
  summary: { text: string; nextSteps: string[] } | null
}

/** 页面上按时间顺序显示的条目，由对话消息推导出来 */
export type AgentTimelineItem =
  | { type: 'agent'; text: string }
  | { type: 'answer'; text: string }
  /** 跳过、要求结束这类操作 */
  | { type: 'action'; text: string }
  | { type: 'step'; id: string; tool: string; label: string; error: string | null; running?: boolean }
  | {
      type: 'question'
      id: string
      questionId: number
      title: string
      category: string
      difficulty: number
      path: string
      /** 第几道主问题 */
      index: number
      followUp: string | null
    }
  | {
      type: 'assessment'
      id: string
      questionId: number
      title: string
      score: number
      strengths: string[]
      gaps: string[]
      /** 下次复习日期（主问题才有） */
      nextReview: string | null
    }
  | { type: 'finish'; id: string; summary: string; nextSteps: string[] }

export interface AgentSessionSummary {
  id: number
  goal: string
  status: 'active' | 'finished'
  maxQuestions: number
  /** 已问的主问题数 */
  asked: number
  /** 主问题的平均分 */
  score: number | null
  createdAt: string
  updatedAt: string
}

export interface AgentSessionDetail extends AgentSessionSummary {
  timeline: AgentTimelineItem[]
  /** 正在等候选人回答的题；没有时为 null */
  awaiting: { questionId: number; title: string; followUp: string | null } | null
}
