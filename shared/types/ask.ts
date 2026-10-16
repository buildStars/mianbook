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
  /** 重排前（融合排序里）的排名 */
  fusedRank: number
  rerankScore: number | null
}

/** 一次检索的重排情况；没配置重排模型或这次没开时为 null */
export interface RagRerankInfo {
  model: string
  /** 是否按重排分数调整了顺序；为 false 时用的是融合排序，error 是原因（候选不到两块时 error 为 null） */
  applied: boolean
  /** 同一个问题、同一批候选重排过，这次直接用了缓存的分数 */
  cached: boolean
  /** 交给重排模型的候选块数 */
  candidates: number
  ms: number
  error: string | null
}

export interface RagDebugResult {
  mode: 'hybrid' | 'keyword' | 'vector'
  embedMs: number
  tookMs: number
  warning: string | null
  rerank: RagRerankInfo | null
  hits: RagDebugHit[]
}

export interface RagStatus {
  questions: number
  chunks: number
  embedded: number
  embed: { model: string; baseUrl: string } | null
  /** 重排模型；lastError 是最近一次出错（之后调用成功会清掉） */
  rerank: { model: string; baseUrl: string; candidates: number; lastError: { message: string; at: string } | null } | null
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
