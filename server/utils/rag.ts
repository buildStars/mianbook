import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import {
  bufferToVector,
  buildRetriever,
  chunkQuestion,
  embedInput,
  embedTexts,
  hashText,
  retrieve,
  vectorToBuffer,
  type EmbedTarget,
  type IndexedChunk,
  type RetrievalResult,
  type RetrieveOptions,
  type Retriever,
} from './rag-core'

/** 向量模型配置；没填 Key 时为 null，只用关键词检索 */
export function embedTarget(): EmbedTarget | null {
  const { embed } = useRuntimeConfig()
  const apiKey = String(embed.apiKey || '')
  if (!apiKey) return null
  return {
    baseUrl: String(embed.baseUrl || '').replace(/\/+$/, ''),
    apiKey,
    model: String(embed.model || ''),
    batchSize: Number(embed.batchSize) || 16,
  }
}

// ---------- 内存里的检索器 ----------

let retrieverPromise: Promise<Retriever> | null = null

export function invalidateRetriever() {
  retrieverPromise = null
}

/** 把所有块读进内存建索引：几千块、每块 4KB 向量，十几 MB，查询时不用访问数据库 */
async function loadRetriever(): Promise<Retriever> {
  const outline = await getOutline()
  const meta = new Map<number, { title: string; path: string; category: string }>()
  for (const part of outline) {
    for (const cat of part.categories) {
      for (const q of cat.questions) meta.set(q.id, { title: q.title, path: q.path, category: cat.title })
    }
  }
  const model = embedTarget()?.model
  const t = tables.questionChunks
  const rows = await useDb()
    .select({ id: t.id, questionId: t.questionId, heading: t.heading, text: t.text, embedding: t.embedding, embedModel: t.embedModel })
    .from(t)
    .orderBy(asc(t.questionId), asc(t.ord))
  const list: IndexedChunk[] = []
  for (const r of rows) {
    const m = meta.get(r.questionId)
    if (!m) continue // 草稿或刚删除的题
    list.push({
      id: r.id,
      questionId: r.questionId,
      ...m,
      heading: r.heading,
      text: r.text,
      // 换了向量模型、还没重新生成的旧向量不能和新模型的问题向量比较
      vector: r.embedding && model && r.embedModel === model ? bufferToVector(r.embedding) : null,
    })
  }
  return buildRetriever(list)
}

export function getRetriever(): Promise<Retriever> {
  retrieverPromise ??= loadRetriever().catch((error) => {
    retrieverPromise = null
    throw error
  })
  return retrieverPromise
}

// 问题向量的缓存：同一个问题（比如示例问题、刷新重试）不用重复请求向量接口
const queryCache = new Map<string, Float32Array>()
const QUERY_CACHE_SIZE = 500

async function embedQuery(target: EmbedTarget, query: string): Promise<Float32Array> {
  const key = `${target.model}\n${query}`
  const cached = queryCache.get(key)
  if (cached) {
    // 重新插入，Map 的顺序就是最近使用的顺序（LRU）
    queryCache.delete(key)
    queryCache.set(key, cached)
    return cached
  }
  const { vectors } = await embedTexts(target, [query], AbortSignal.timeout(10_000))
  queryCache.set(key, vectors[0]!)
  if (queryCache.size > QUERY_CACHE_SIZE) queryCache.delete(queryCache.keys().next().value!)
  return vectors[0]!
}

export interface HandbookSearch extends RetrievalResult {
  /** 生成问题向量的耗时和总耗时（毫秒） */
  embedMs: number
  tookMs: number
  /** 向量接口出错时退化为只用关键词，这里是原因 */
  warning: string | null
}

/** 检索手册：有向量时混合检索，向量接口出错时退化为只用关键词，不影响回答 */
export async function searchHandbook(query: string, options: RetrieveOptions = {}): Promise<HandbookSearch> {
  const started = performance.now()
  const retriever = await getRetriever()
  const target = embedTarget()
  let vector: Float32Array | null = null
  let warning: string | null = null
  let embedMs = 0
  if (target && retriever.vectorCount && options.only !== 'keyword') {
    const t0 = performance.now()
    try {
      vector = await embedQuery(target, query)
    } catch (error) {
      warning = error instanceof Error ? error.message : '向量接口出错'
      console.error('[rag] 生成问题向量失败，改用关键词检索', error)
    }
    embedMs = Math.round(performance.now() - t0)
  }
  const result = retrieve(retriever, query, vector, options)
  return { ...result, embedMs, tookMs: Math.round(performance.now() - started), warning }
}

// ---------- 同步索引 ----------

export interface RagSyncStats {
  /** 内容有变化、重新切块的题 */
  questionsChanged: number
  questionsRemoved: number
  /** 这次新生成向量的块 */
  embedded: number
  /** 复用旧向量的块（内容没变，只是位置变了） */
  reused: number
  embedTokens: number
  tookMs: number
  error: string | null
}

const state = {
  running: null as Promise<RagSyncStats> | null,
  again: false,
  lastSyncAt: null as Date | null,
  lastStats: null as RagSyncStats | null,
}

/**
 * 让索引和已发布的题目一致：切块、比较哈希、只给新的或变了的块生成向量。
 * 同一时间只跑一个；运行中又被调用时，结束后再跑一次，保证最后一次修改也被同步
 */
export function syncRagIndex(): Promise<RagSyncStats> {
  if (state.running) {
    state.again = true
    return state.running
  }
  state.running = (async () => {
    // 跑了好几轮时把每轮的结果加起来，调用方能看到包含自己那次修改的完整结果
    let total: RagSyncStats | null = null
    do {
      state.again = false
      const stats = await runSync()
      total = total
        ? {
            questionsChanged: total.questionsChanged + stats.questionsChanged,
            questionsRemoved: total.questionsRemoved + stats.questionsRemoved,
            embedded: total.embedded + stats.embedded,
            reused: total.reused + stats.reused,
            embedTokens: total.embedTokens + stats.embedTokens,
            tookMs: total.tookMs + stats.tookMs,
            error: stats.error,
          }
        : stats
      state.lastSyncAt = new Date()
      state.lastStats = total
    } while (state.again)
    // 提前建好内存索引，第一个提问的人不用等
    getRetriever().catch(() => {})
    return total
  })().finally(() => {
    state.running = null
  })
  return state.running
}

let timer: ReturnType<typeof setTimeout> | undefined

/** 题目变动后稍等一会儿再同步：连续保存、批量操作只同步一次 */
export function scheduleRagSync(delayMs = 3000) {
  clearTimeout(timer)
  timer = setTimeout(() => {
    syncRagIndex().catch((error) => console.error('[rag] 同步索引失败', error))
  }, delayMs)
}

async function runSync(): Promise<RagSyncStats> {
  const started = performance.now()
  const db = useDb()
  const t = tables.questionChunks
  const stats: RagSyncStats = { questionsChanged: 0, questionsRemoved: 0, embedded: 0, reused: 0, embedTokens: 0, tookMs: 0, error: null }

  const questions = await db
    .select({ id: tables.questions.id, title: tables.questions.title, contentMd: tables.questions.contentMd })
    .from(tables.questions)
    .where(eq(tables.questions.status, 'published'))
  const existing = await db.select({ questionId: t.questionId, ord: t.ord, hash: t.hash }).from(t).orderBy(asc(t.questionId), asc(t.ord))
  const oldHashes = new Map<number, string[]>()
  for (const row of existing) {
    const list = oldHashes.get(row.questionId) ?? []
    list.push(row.hash)
    oldHashes.set(row.questionId, list)
  }

  // 1. 下线或删除的题：删掉它们的块（删除题目时外键也会级联删除）
  const published = new Set(questions.map((q) => q.id))
  const removed = [...oldHashes.keys()].filter((id) => !published.has(id))
  if (removed.length) {
    await db.delete(t).where(inArray(t.questionId, removed))
    stats.questionsRemoved = removed.length
  }

  // 2. 内容变了的题：重新切块，哈希相同的块沿用旧向量
  for (const q of questions) {
    const drafts = chunkQuestion(q.contentMd)
    const hashes = drafts.map((d) => hashText(embedInput(q.title, d)))
    const old = oldHashes.get(q.id) ?? []
    if (old.length === hashes.length && old.every((h, i) => h === hashes[i])) continue

    stats.questionsChanged++
    await db.transaction(async (tx) => {
      const previous = await tx
        .select({ hash: t.hash, embedding: t.embedding, embedModel: t.embedModel })
        .from(t)
        .where(eq(t.questionId, q.id))
      const reusable = new Map(previous.filter((p) => p.embedding).map((p) => [p.hash, p]))
      await tx.delete(t).where(eq(t.questionId, q.id))
      if (!drafts.length) return
      await tx.insert(t).values(
        drafts.map((d, i) => {
          const old = reusable.get(hashes[i]!)
          if (old) stats.reused++
          return {
            questionId: q.id,
            ord: d.ord,
            heading: d.heading.slice(0, 255),
            text: d.text,
            hash: hashes[i]!,
            embedding: old?.embedding ?? null,
            embedModel: old?.embedModel ?? null,
          }
        }),
      )
    })
  }

  // 3. 给没有向量（或向量是旧模型生成的）的块生成向量
  const target = embedTarget()
  if (target) {
    try {
      while (true) {
        const pending = await db
          .select({ id: t.id, heading: t.heading, text: t.text, title: tables.questions.title })
          .from(t)
          .innerJoin(tables.questions, eq(tables.questions.id, t.questionId))
          .where(or(isNull(t.embedding), isNull(t.embedModel), ne(t.embedModel, target.model)))
          .orderBy(asc(t.id))
          .limit(target.batchSize! * 4)
        if (!pending.length) break
        const { vectors, tokens } = await embedTexts(
          target,
          pending.map((p) => embedInput(p.title, p)),
        )
        stats.embedTokens += tokens
        for (let i = 0; i < pending.length; i++) {
          await db
            .update(t)
            .set({ embedding: vectorToBuffer(vectors[i]!), embedModel: target.model })
            .where(eq(t.id, pending[i]!.id))
        }
        stats.embedded += pending.length
      }
    } catch (error) {
      // 向量接口出错不影响关键词检索，下次同步（重启、改题、后台点"立即同步"）会接着生成
      stats.error = error instanceof Error ? error.message : String(error)
      console.error('[rag] 生成向量失败', error)
    }
  }

  if (stats.questionsChanged || stats.questionsRemoved || stats.embedded) invalidateRetriever()
  stats.tookMs = Math.round(performance.now() - started)
  if (stats.questionsChanged || stats.embedded || stats.error) {
    console.log(
      `[rag] 同步完成：${stats.questionsChanged} 道题重新切块，生成 ${stats.embedded} 个向量，复用 ${stats.reused} 个，用时 ${stats.tookMs}ms${stats.error ? `，出错：${stats.error}` : ''}`,
    )
  }
  return stats
}

/** 后台显示的索引状态 */
export async function ragStatus() {
  const t = tables.questionChunks
  const target = embedTarget()
  const [row] = await useDb()
    .select({
      chunks: sql<number>`count(*)`,
      questions: sql<number>`count(distinct ${t.questionId})`,
      embedded: target
        ? sql<number>`coalesce(sum(${t.embedding} is not null and ${t.embedModel} = ${target.model}), 0)`
        : sql<number>`0`,
    })
    .from(t)
    .innerJoin(tables.questions, and(eq(tables.questions.id, t.questionId), eq(tables.questions.status, 'published')))
  return {
    questions: Number(row?.questions ?? 0),
    chunks: Number(row?.chunks ?? 0),
    embedded: Number(row?.embedded ?? 0),
    embed: target ? { model: target.model, baseUrl: target.baseUrl } : null,
    running: Boolean(state.running),
    lastSyncAt: state.lastSyncAt?.toISOString() ?? null,
    lastStats: state.lastStats,
  }
}
