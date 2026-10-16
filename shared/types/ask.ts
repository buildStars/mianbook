/** 问手册：回答引用的一段资料 */
export interface AskSourceView {
  /** 回答里 [n] 对应的编号 */
  n: number
  questionId: number
  title: string
  path: string
  category: string
  heading: string
  /** 资料开头的一小段，用来预览 */
  snippet: string
}

/** 问手册接口的 SSE 事件 */
export interface AskSourcesEvent {
  sources: AskSourceView[]
}

export interface AskDoneEvent {
  /** 回答里实际引用了哪些编号 */
  citations: number[]
  /** 今天还剩几次；用自己的 Key 时为 null */
  remaining: number | null
}

/** 后台检索调试：一条结果 */
export interface RagDebugHit {
  rank: number
  questionId: number
  title: string
  path: string
  heading: string
  snippet: string
  score: number
  keywordRank: number | null
  vectorRank: number | null
  similarity: number | null
}

export interface RagDebugResult {
  mode: 'hybrid' | 'keyword' | 'vector'
  embedMs: number
  tookMs: number
  warning: string | null
  hits: RagDebugHit[]
}

export interface RagStatus {
  questions: number
  chunks: number
  embedded: number
  embed: { model: string; baseUrl: string } | null
  running: boolean
  lastSyncAt: string | null
  lastStats: {
    questionsChanged: number
    questionsRemoved: number
    embedded: number
    reused: number
    embedTokens: number
    tookMs: number
    error: string | null
  } | null
}
