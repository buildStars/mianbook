import { z } from 'zod'
import type { RagDebugResult } from '#shared/types/ask'

const schema = z.object({
  q: z.string().trim().min(1, '请输入要检索的内容').max(500),
  only: z.enum(['keyword', 'vector']).optional(),
  /** 传 0 不重排，对比重排前后的顺序 */
  rerank: z.enum(['0', '1']).optional(),
})

/** 检索调试：看一个问题在关键词、向量两路里各排第几，融合、重排后是什么顺序（不调用大模型） */
export default defineEventHandler(async (event): Promise<RagDebugResult> => {
  await requireAdmin(event)
  const { q, only, rerank } = queryValidated(event, schema)
  const found = await searchHandbook(q, { limit: 10, perQuestion: 2, only, rerank: rerank !== '0' })
  return {
    mode: found.mode,
    embedMs: found.embedMs,
    tookMs: found.tookMs,
    warning: found.warning,
    rerank: found.rerank,
    hits: found.hits.map((h, i) => ({
      rank: i + 1,
      questionId: h.chunk.questionId,
      title: h.chunk.title,
      path: h.chunk.path,
      heading: h.chunk.heading,
      snippet: h.chunk.text.slice(0, 160),
      score: h.score,
      keywordRank: h.keywordRank,
      vectorRank: h.vectorRank,
      similarity: h.similarity,
      fusedRank: h.fusedRank,
      rerankScore: h.rerankScore,
    })),
  }
})
