import type { RagStatus } from '#shared/types/ask'

/** 问手册检索索引的状态：分块数、已生成向量的块数、最近一次同步的结果 */
export default defineEventHandler(async (event): Promise<RagStatus> => {
  await requireAdmin(event)
  return ragStatus()
})
