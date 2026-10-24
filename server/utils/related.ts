import type { RelatedQuestion } from '#shared/types/handbook'
import type { LocatedQuestion } from './handbook'
import type { Retriever } from './rag-core'

interface RelatedCache {
  /** 题目 id → 题目向量（分块向量的平均） */
  vectors: Map<number, Float32Array>
  /** 题目 id → 关键词检索用的查询：标题加一句话回答 */
  queries: Map<number, string>
  results: Map<number, RelatedQuestion[]>
}

/** 跟着检索索引走：题目或向量变了会换一个新的 Retriever，缓存自然失效 */
const caches = new WeakMap<Retriever, RelatedCache>()

function cacheFor(retriever: Retriever): RelatedCache {
  let cache = caches.get(retriever)
  if (!cache) {
    const grouped = new Map<number, Float32Array[]>()
    const queries = new Map<number, string>()
    for (const chunk of retriever.chunks.values()) {
      if (!queries.has(chunk.questionId)) queries.set(chunk.questionId, chunk.title.replace(/`/g, ''))
      if (chunk.heading === '一句话回答') queries.set(chunk.questionId, `${queries.get(chunk.questionId)} ${chunk.text}`)
      if (!chunk.vector) continue
      const list = grouped.get(chunk.questionId) ?? []
      list.push(chunk.vector)
      grouped.set(chunk.questionId, list)
    }
    const vectors = new Map<number, Float32Array>()
    for (const [id, list] of grouped) vectors.set(id, meanVector(list)!)
    cache = { vectors, queries, results: new Map() }
    caches.set(retriever, cache)
  }
  return cache
}

const RANK_DEPTH = 30

/**
 * 题目页底部的相关题目：向量相似度（题目向量的余弦）和关键词两路排名用 RRF 融合，同分类最多 2 道，
 * 不推荐上一题、下一题。关键词这一路用标题加一句话回答去搜，按每道题最相关的两块打分。
 * 检索索引还没准备好（刚启动、空库）时，用同分类的题补足
 */
export async function relatedQuestions(located: LocatedQuestion, limit = 6): Promise<RelatedQuestion[]> {
  const outline = await getOutline()
  const info = new Map<number, RelatedQuestion & { categoryId: number }>()
  for (const part of outline) {
    for (const cat of part.categories) {
      for (const q of cat.questions) {
        info.set(q.id, { id: q.id, title: q.title, path: q.path, category: cat.title, difficulty: q.difficulty, categoryId: cat.id })
      }
    }
  }
  const self = located.question.id
  const exclude = new Set([located.prev?.id, located.next?.id].filter((id): id is number => id !== undefined))

  let picked: number[] = []
  // 索引加载慢时不让页面一直等，超过 1.5 秒就只用同分类补足
  let timer: ReturnType<typeof setTimeout> | undefined
  const retriever = await Promise.race([
    getRetriever().catch(() => null),
    new Promise<null>((r) => (timer = setTimeout(() => r(null), 1500))),
  ]).finally(() => clearTimeout(timer))
  if (retriever && retriever.chunks.size) {
    const cache = cacheFor(retriever)
    const cached = cache.results.get(self)
    if (cached) return cached

    const vectorRank: number[] = []
    const own = cache.vectors.get(self)
    if (own) {
      vectorRank.push(
        ...[...cache.vectors]
          .filter(([id]) => id !== self)
          .map(([id, v]) => ({ id, score: dotProduct(own, v) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, RANK_DEPTH)
          .map((r) => r.id),
      )
    }
    const query = cache.queries.get(self) ?? located.question.title.replace(/`/g, '')
    const hits = retriever.keyword.search(query).flatMap((hit) => {
      const chunk = retriever.chunks.get(hit.id as number)
      return chunk ? [{ questionId: chunk.questionId, heading: chunk.heading, score: hit.score }] : []
    })
    const keywordRank = rankByChunkHits(hits, self, RANK_DEPTH)
    const categoryOf = new Map([...info].map(([id, q]) => [id, q.categoryId]))
    picked = pickRelated([vectorRank, keywordRank], { selfId: self, exclude, categoryOf, limit })
  }

  // 不够时用同分类、离得最近的题补足
  if (picked.length < limit) {
    const siblings = located.category.questions.map((q) => q.id)
    const at = siblings.indexOf(self)
    const near = siblings
      .map((id, i) => ({ id, d: Math.abs(i - at) }))
      .filter(({ id }) => id !== self && !exclude.has(id) && !picked.includes(id))
      .sort((a, b) => a.d - b.d)
    for (const { id } of near) {
      if (picked.length >= limit) break
      picked.push(id)
    }
  }

  const result = picked.map((id) => {
    const { categoryId: _, ...q } = info.get(id)!
    return q
  })
  if (retriever && retriever.chunks.size) cacheFor(retriever).results.set(self, result)
  return result
}
