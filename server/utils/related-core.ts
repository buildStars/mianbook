// 相关题目里不依赖数据库的部分：题目向量、关键词命中的汇总、两路排名融合和挑选规则，单元测试直接引用
import { normalizeVector, rrf } from './rag-core'

/** 一道题的向量：它所有分块向量的平均（再归一化）；没有任何向量时返回 null */
export function meanVector(vectors: Float32Array[]): Float32Array | null {
  if (!vectors.length) return null
  const sum = new Float32Array(vectors[0]!.length)
  for (const v of vectors) for (let i = 0; i < sum.length; i++) sum[i]! += v[i]!
  return normalizeVector(sum)
}

export interface ChunkHit {
  questionId: number
  heading: string
  score: number
}

/**
 * 把分块级的关键词命中汇总成题目排名：每道题取分数最高的两块相加（多处都相关的题比只有一句话撞上的题更相关），
 * 代码示例里的变量名、注释容易和不相干的题撞上，不算
 */
export function rankByChunkHits(hits: ChunkHit[], selfId: number, depth = 30): number[] {
  const scores = new Map<number, number[]>()
  for (const hit of hits) {
    if (hit.questionId === selfId || hit.heading.startsWith('代码')) continue
    const list = scores.get(hit.questionId) ?? []
    if (list.length < 2) list.push(hit.score)
    scores.set(hit.questionId, list)
  }
  return [...scores]
    .map(([id, s]) => ({ id, score: s.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, depth)
    .map((r) => r.id)
}

export interface PickOptions {
  selfId: number
  /** 不推荐的题：上一题、下一题已经在页面上了 */
  exclude: Set<number>
  /** 题目 id → 分类 id，用来限制同分类的数量 */
  categoryOf: Map<number, number>
  limit?: number
  /** 同分类最多几道，留出位置给跨分类的关联（同分类的题侧栏里已经有） */
  maxSameCategory?: number
}

/**
 * 把几路排名（向量相似度、关键词）用 RRF 融合，按顺序挑相关题目：
 * 跳过自己和 exclude 里的题、不在 categoryOf 里（未发布）的题，同分类最多 maxSameCategory 道
 */
export function pickRelated(rankings: number[][], options: PickOptions): number[] {
  const { selfId, exclude, categoryOf, limit = 5, maxSameCategory = 2 } = options
  const own = categoryOf.get(selfId)
  const fused = rrf(rankings.map((ids) => ids.map((id) => ({ id, score: 0 }))))
  const picked: number[] = []
  let sameCategory = 0
  for (const { id } of fused) {
    if (picked.length >= limit) break
    if (id === selfId || exclude.has(id) || !categoryOf.has(id)) continue
    if (categoryOf.get(id) === own) {
      if (sameCategory >= maxSameCategory) continue
      sameCategory++
    }
    picked.push(id)
  }
  return picked
}
