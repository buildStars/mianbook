/**
 * 问手册（RAG）的核心逻辑：切块、关键词检索、向量检索、RRF 融合、评测指标。
 * 都是纯函数，不依赖数据库和运行时配置：服务端和评测脚本（scripts/eval-retrieval.ts）共用
 */
import crypto from 'node:crypto'
import MiniSearch from 'minisearch'

// ---------- 切块 ----------

export interface ChunkDraft {
  ord: number
  /** 小节标题，如"一句话回答""详细解析""追问：布隆过滤器的原理？" */
  heading: string
  /** 清理过 Markdown 标记的正文，用于检索、展示和放进提示词 */
  text: string
}

const MAX_CHARS = 900
const MAX_CODE_LINES = 40

/** 去掉 Markdown 标记，保留文字和代码内容 */
export function cleanMarkdown(md: string): string {
  const out: string[] = []
  let fence: string | null = null
  let codeLines = 0
  for (const line of md.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
    if (marker) {
      if (!fence) {
        fence = marker
        codeLines = 0
      } else if (marker.startsWith(fence)) {
        fence = null
      }
      continue
    }
    if (fence) {
      // 长代码只保留前面一部分：检索靠注释和关键 API，太长反而稀释语义
      if (++codeLines === MAX_CODE_LINES + 1) out.push('…')
      if (codeLines <= MAX_CODE_LINES) out.push(line)
      continue
    }
    // 容器：::: tip 标题 → "标题："，结束标记直接去掉
    const container = line.match(/^:::\s*\w+\s*(.*)$/)
    if (container) {
      if (container[1]) out.push(`${container[1].trim()}：`)
      continue
    }
    if (/^:::\s*$/.test(line)) continue
    // 表格分隔行
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue
    let text = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
    // 表格行：去掉两边的竖线，单元格之间留一个分隔
    if (/^\s*\|/.test(line)) text = text.replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*/g, ' | ')
    out.push(text)
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 资料的预览（问手册里"参考了 N 段"下面那一小段）：分块文本为了检索保留了列表符号和表格竖线，
 * 给人看时去掉列表符号、表格单元格之间换成逗号（只认两边有空格的单个竖线，代码里的 || 不动），合成一行再截断
 */
export function previewText(text: string, max = 140): string {
  const flat = text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/(?<!\|) \| (?!\|)/g, '，')
        .trim(),
    )
    .filter(Boolean)
    .join(' ')
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** 按段落把长文本切成不超过 max 字的几段；单个段落太长时按行切 */
export function splitLong(text: string, max = MAX_CHARS): string[] {
  if (text.length <= max) return [text]
  const pieces: string[] = []
  let current = ''
  const push = () => {
    if (current.trim()) pieces.push(current.trim())
    current = ''
  }
  for (const para of text.split(/\n{2,}/)) {
    const units = para.length > max ? para.split('\n') : [para]
    for (const unit of units) {
      // 极端情况：一行就超长，硬切
      for (let i = 0; i < unit.length; i += max) {
        const part = unit.slice(i, i + max)
        if (current && current.length + part.length + 2 > max) push()
        current += (current ? (units.length > 1 ? '\n' : '\n\n') : '') + part
      }
    }
  }
  push()
  return pieces
}

/**
 * 把一道题切成检索用的块：
 * - "一句话回答"单独一块，它是整题的摘要，命中率最高
 * - 每个二级标题一块，太长时按段落再切
 * - "面试官可能追问"里的每个折叠块各成一块，用户经常直接问追问的内容
 */
export function chunkQuestion(contentMd: string): ChunkDraft[] {
  const md = contentMd.replace(/\r\n/g, '\n')
  const drafts: Omit<ChunkDraft, 'ord'>[] = []
  const add = (heading: string, raw: string) => {
    const text = cleanMarkdown(raw)
    if (!text) return
    splitLong(text).forEach((piece, i) => drafts.push({ heading: i ? `${heading}（续）` : heading, text: piece }))
  }

  // 按二级标题分节，代码块里的 ## 不算
  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }]
  let fence: string | null = null
  for (const line of md.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
    if (marker) fence = fence ? (marker.startsWith(fence) ? null : fence) : marker
    const h2 = !fence && line.match(/^##\s+(.+?)\s*$/)
    if (h2) sections.push({ heading: h2[1]!.replace(/`/g, ''), lines: [] })
    else sections.at(-1)!.lines.push(line)
  }

  for (const section of sections) {
    let body = section.lines.join('\n')
    if (!section.heading) {
      // 第一个二级标题之前：一句话回答，以及可能有的引言
      const tip = body.match(/^::: tip 一句话回答[^\n]*\n([\s\S]*?)\n:::\s*$/m)
      if (tip) {
        add('一句话回答', tip[1]!)
        body = body.replace(tip[0], '')
      }
      add('引言', body)
      continue
    }
    const followUp = section.heading.includes('追问')
    // 折叠块（::: details 问题 … :::）各成一块
    body = body.replace(/^::: details\s+(.+?)\s*\n([\s\S]*?)\n:::\s*$/gm, (_m, q: string, answer: string) => {
      const title = q.replace(/`/g, '')
      add(followUp ? `追问：${title}` : `${section.heading} · ${title}`, `${title}\n${answer}`)
      return ''
    })
    add(section.heading, body)
  }
  return drafts.map((d, ord) => ({ ...d, ord }))
}

/** 交给向量模型的文本：带上题目和小节标题，单独看一块也知道在讲什么 */
export const embedInput = (title: string, chunk: Pick<ChunkDraft, 'heading' | 'text'>) =>
  `${title.replace(/`/g, '')}\n${chunk.heading}\n${chunk.text}`

export const hashText = (text: string) => crypto.createHash('sha256').update(text).digest('hex')

// ---------- 向量 ----------

export function normalizeVector(v: ArrayLike<number>): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!
  const norm = Math.sqrt(sum) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm
  return out
}

/** 两个已经归一化的向量的余弦相似度 */
export function dotProduct(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

export const vectorToBuffer = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength)

/** 数据库读出来的 Buffer 不一定按 4 字节对齐，先复制一份再当 Float32Array 用 */
export const bufferToVector = (b: Uint8Array) => new Float32Array(new Uint8Array(b).buffer)

export interface EmbedTarget {
  baseUrl: string
  apiKey: string
  model: string
  batchSize?: number
}

export class EmbedError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message)
  }
}

/** 调用 OpenAI 兼容的 /embeddings 接口，按批次请求，返回归一化后的向量。fetchImpl：服务端传保持连接的 fetch */
export async function embedTexts(
  target: EmbedTarget,
  texts: string[],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ vectors: Float32Array[]; tokens: number }> {
  const size = Math.max(1, target.batchSize ?? 16)
  const vectors: Float32Array[] = []
  let tokens = 0
  for (let i = 0; i < texts.length; i += size) {
    const input = texts.slice(i, i + size)
    const res = await fetchImpl(`${target.baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify({ model: target.model, input, encoding_format: 'float' }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      redirect: 'error',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const detail = String(body?.error?.message ?? body?.message ?? '').slice(0, 200)
      throw new EmbedError(`向量接口出错（${res.status}）${detail ? `：${detail}` : ''}`, res.status)
    }
    const body = await res.json()
    const data: { index?: number; embedding: number[] }[] = body?.data ?? []
    if (data.length !== input.length) throw new EmbedError(`向量接口返回了 ${data.length} 条，期望 ${input.length} 条`)
    data
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .forEach((d) => vectors.push(normalizeVector(d.embedding)))
    tokens += Number(body?.usage?.total_tokens ?? body?.usage?.prompt_tokens ?? 0)
  }
  return { vectors, tokens }
}

// ---------- 检索 ----------

/** 检索时忽略的词：疑问词、语气词、"说说""介绍一下"这类口头禅 */
const STOPWORDS = new Set(
  (
    '的 了 是 在 和 与 及 或 吗 呢 吧 啊 呀 么 嘛 什么 怎么 怎样 怎么样 如何 为什么 为啥 咋 啥 哪些 哪个 有 有没有 没有 ' +
    '一个 一下 一些 这个 那个 这些 那些 这样 那样 我 你 他 她 它 我们 你们 他们 请 请问 能 能否 可以 会 要 想 就 都 也 还 又 ' +
    '把 被 让 对 从 到 给 用 说说 讲讲 谈谈 聊聊 介绍 解释 一般 通常 主要 分别 以及 时候 应该 需要 回事 怎么办 是不是 会不会 干嘛 ' +
    '一直 总是 老是 the a an is are was of to in on ' +
    'and or what how why which do does can'
  ).split(/\s+/),
)

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

const SINGLE_HAN = /^\p{Script=Han}$/u

/**
 * 分词：Intl.Segmenter 的中文词典不全，常把"页面""加载"切成单字，单字又容易误匹配（"页"命中"分页"）。
 * 所以连续的单字两两组成双字词（页面、加载），只有前后都不是单字的孤立单字（如"锁"）才保留
 */
export function tokenizeSearchText(text: string): string[] {
  const words: string[] = []
  let run: string[] = []
  const flush = () => {
    if (run.length === 1) words.push(run[0]!)
    for (let i = 0; i + 1 < run.length; i++) words.push(run[i]! + run[i + 1]!)
    run = []
  }
  for (const s of segmenter.segment(text)) {
    if (!s.isWordLike) {
      flush()
      continue
    }
    if (SINGLE_HAN.test(s.segment)) run.push(s.segment)
    else {
      flush()
      words.push(s.segment)
    }
  }
  flush()
  return words
}

const processTerm = (term: string) => {
  const t = term.toLowerCase()
  return STOPWORDS.has(t) ? null : t
}

export interface IndexedChunk {
  id: number
  questionId: number
  title: string
  path: string
  category: string
  heading: string
  text: string
  /** 没有向量（没配置向量模型或还没生成）时为 null */
  vector: Float32Array | null
}

export interface Retriever {
  chunks: Map<number, IndexedChunk>
  keyword: MiniSearch<IndexedChunk>
  /** 有向量的块数和维度 */
  vectorCount: number
  dims: number
}

export function buildRetriever(list: IndexedChunk[]): Retriever {
  const keyword = new MiniSearch<IndexedChunk>({
    fields: ['title', 'heading', 'text'],
    tokenize: tokenizeSearchText,
    processTerm,
    searchOptions: {
      boost: { title: 2, heading: 1.5 },
      combineWith: 'OR',
      // 英文词才做前缀匹配（如 useEff → useEffect），中文词前缀匹配噪声太大
      prefix: (term) => /^[a-z0-9]/.test(term) && term.length >= 3,
      fuzzy: 0.1,
    },
  })
  keyword.addAll(list)
  const withVector = list.filter((c) => c.vector)
  return {
    chunks: new Map(list.map((c) => [c.id, c])),
    keyword,
    vectorCount: withVector.length,
    dims: withVector[0]?.vector?.length ?? 0,
  }
}

export interface Ranked {
  id: number
  score: number
}

export function keywordSearch(r: Retriever, query: string, limit = 30): Ranked[] {
  if (!query.trim()) return []
  return r.keyword
    .search(query)
    .slice(0, limit)
    .map((hit) => ({ id: hit.id as number, score: hit.score }))
}

/** 暴力计算和所有块的相似度。几千块只要几毫秒；到几十万块再换成向量数据库的近似检索（HNSW 等） */
export function vectorSearch(r: Retriever, query: Float32Array, limit = 30): Ranked[] {
  const scored: Ranked[] = []
  for (const c of r.chunks.values()) {
    if (!c.vector || c.vector.length !== query.length) continue
    const score = dotProduct(c.vector, query)
    // 相似度不大于 0 说明毫不相关（真实模型几乎不会出现），不参与排名
    if (score > 0) scored.push({ id: c.id, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * 倒数排名融合（Reciprocal Rank Fusion）：score = Σ 1 / (k + 排名)。
 * 只看排名不看分数，BM25 分数和余弦相似度量纲不同也能直接合并
 */
export function rrf(lists: Ranked[][], k = 60): Ranked[] {
  const fused = new Map<number, number>()
  for (const list of lists) {
    list.forEach((item, i) => fused.set(item.id, (fused.get(item.id) ?? 0) + 1 / (k + i + 1)))
  }
  return [...fused].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score)
}

export interface RetrievalHit {
  chunk: IndexedChunk
  /** 融合后的分数 */
  score: number
  /** 在关键词、向量结果里的排名（从 1 开始），没有命中为 null */
  keywordRank: number | null
  vectorRank: number | null
  /** 和问题的余弦相似度 */
  similarity: number | null
  /** 融合排序（每道题限块数之后）里的排名，从 1 开始；重排后对照它能看出每块挪了几位 */
  fusedRank: number
  /** 重排模型给的相关度，没有重排时为 null */
  rerankScore: number | null
}

export interface RetrievalResult {
  mode: 'hybrid' | 'keyword' | 'vector'
  hits: RetrievalHit[]
}

export interface RetrieveOptions {
  /** 返回几块 */
  limit?: number
  /** 同一道题最多几块，避免一道长题占满所有位置 */
  perQuestion?: number
  /** 每路检索取前几名参与融合 */
  candidates?: number
  /** 只用其中一路，评测时对比用 */
  only?: 'keyword' | 'vector'
}

export function retrieve(r: Retriever, query: string, queryVector: Float32Array | null, options: RetrieveOptions = {}): RetrievalResult {
  const { limit = 6, perQuestion = 2, candidates = 30, only } = options
  const useVector = Boolean(queryVector && r.vectorCount && only !== 'keyword')
  const keyword = only === 'vector' ? [] : keywordSearch(r, query, candidates)
  const vector = useVector ? vectorSearch(r, queryVector!, candidates) : []
  const keywordRank = new Map(keyword.map((h, i) => [h.id, i + 1]))
  const vectorRank = new Map(vector.map((h, i) => [h.id, i + 1]))
  const similarity = new Map(vector.map((h) => [h.id, h.score]))

  const fused = rrf([keyword, vector].filter((l) => l.length))
  const perQ = new Map<number, number>()
  const hits: RetrievalHit[] = []
  for (const item of fused) {
    const chunk = r.chunks.get(item.id)!
    const n = perQ.get(chunk.questionId) ?? 0
    if (n >= perQuestion) continue
    perQ.set(chunk.questionId, n + 1)
    hits.push({
      chunk,
      score: item.score,
      keywordRank: keywordRank.get(item.id) ?? null,
      vectorRank: vectorRank.get(item.id) ?? null,
      similarity: similarity.get(item.id) ?? null,
      fusedRank: hits.length + 1,
      rerankScore: null,
    })
    if (hits.length >= limit) break
  }
  return { mode: only ?? (useVector ? 'hybrid' : 'keyword'), hits }
}

// ---------- 重排 ----------

export interface RerankTarget {
  baseUrl: string
  apiKey: string
  model: string
}

export class RerankError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message)
  }
}

/**
 * 调用 /rerank 接口（硅基流动、Jina、Cohere 通用的格式）。重排模型把问题和每块资料放在一起读，给出相关度，
 * 比向量的余弦相似度准；但每块都要和问题一起算一遍，所以只用来给检索出的前几十块重新排序。
 * 返回的分数和 documents 一一对应
 */
export async function rerankTexts(
  target: RerankTarget,
  query: string,
  documents: string[],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ scores: number[]; tokens: number }> {
  if (!documents.length) return { scores: [], tokens: 0 }
  const res = await fetchImpl(`${target.baseUrl.replace(/\/+$/, '')}/rerank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
    body: JSON.stringify({ model: target.model, query, documents, top_n: documents.length, return_documents: false }),
    signal: signal ?? AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  if (!res.ok) {
    // 出错时有的返回 JSON（{ message } 或 { error: { message } }），有的直接是一行文字（如 404 page not found）
    const raw = await res.text().catch(() => '')
    let detail: unknown = raw
    try {
      const body = JSON.parse(raw)
      detail = body?.error?.message ?? body?.message ?? raw
    } catch {
      // 不是 JSON，用原文
    }
    const text = String(detail).replace(/\s+/g, ' ').trim().slice(0, 200)
    throw new RerankError(`重排接口出错（${res.status}）${text ? `：${text}` : ''}`, res.status)
  }
  const body = await res.json()
  // 返回结果按相关度排好了序，用 index 对回原来的位置
  const scores: (number | null)[] = documents.map(() => null)
  for (const r of body?.results ?? []) {
    const i = r?.index
    if (Number.isInteger(i) && i >= 0 && i < documents.length && Number.isFinite(r.relevance_score)) scores[i] = r.relevance_score
  }
  const got = scores.filter((s) => s !== null).length
  if (got !== documents.length) throw new RerankError(`重排接口返回了 ${got} 条有效结果，期望 ${documents.length} 条`)
  const tokens = Number(body?.meta?.tokens?.input_tokens ?? body?.usage?.total_tokens ?? 0) || 0
  return { scores: scores as number[], tokens }
}

/** 交给重排模型的文本：和生成向量的一样，带上题目和小节标题 */
export const rerankDocuments = (hits: RetrievalHit[]) => hits.map((h) => embedInput(h.chunk.title, h.chunk))

/** 只按重排分数从高到低排序；分数相同时保持融合排序的先后 */
export function applyRerank(hits: RetrievalHit[], scores: number[]): RetrievalHit[] {
  return hits
    .map((hit, i) => ({ ...hit, rerankScore: scores[i] ?? null }))
    .sort((a, b) => (b.rerankScore ?? -Infinity) - (a.rerankScore ?? -Infinity) || a.fusedRank - b.fusedRank)
}

/**
 * 重排后的最终顺序：融合排序（hits 原来的顺序）和按重排分数的排序再做一次 RRF，两边都靠前的块才排得靠前。
 * 评测里只按重排分数排时，有的题被字面相近、领域不同的块挤了下去（"大文件断点续传"排到了"流式连接断了怎么续传"后面）；
 * 再和融合排序融合一次，各项指标都不低于不重排，见 README 的问手册评测
 */
export function fuseRerank(hits: RetrievalHit[], scores: number[], k = 60): RetrievalHit[] {
  const reranked = applyRerank(hits, scores)
  const byId = new Map(reranked.map((h) => [h.chunk.id, h]))
  const ranked = (list: RetrievalHit[]) => list.map((h) => ({ id: h.chunk.id, score: 0 }))
  return rrf([ranked(hits), ranked(reranked)], k).map((r) => byId.get(r.id)!)
}

// ---------- 评测 ----------

export interface EvalScores {
  /** 前 k 道题里包含期望题目的比例 */
  recall1: number
  recall3: number
  recall5: number
  /** 第一个命中的期望题目排名的倒数的平均值，只看前 10 名 */
  mrr: number
}

/** rankings[i] 是第 i 个问题检索出的题目 id（已去重、按排名），expected[i] 是期望命中的题目 id */
export function scoreRankings(rankings: number[][], expected: number[][]): EvalScores {
  const n = rankings.length || 1
  let r1 = 0
  let r3 = 0
  let r5 = 0
  let mrr = 0
  rankings.forEach((ranked, i) => {
    const want = new Set(expected[i])
    const first = ranked.slice(0, 10).findIndex((id) => want.has(id))
    if (first === 0) r1++
    if (first >= 0 && first < 3) r3++
    if (first >= 0 && first < 5) r5++
    if (first >= 0) mrr += 1 / (first + 1)
  })
  return { recall1: r1 / n, recall3: r3 / n, recall5: r5 / n, mrr: mrr / n }
}

/** 检索结果按题目去重，得到题目 id 的排名 */
export const rankQuestions = (hits: RetrievalHit[]) => [...new Set(hits.map((h) => h.chunk.questionId))]
