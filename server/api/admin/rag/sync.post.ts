import type { RagStatus } from '#shared/types/ask'

/** 立即同步索引并等它完成；返回这次同步的结果，向量接口出错时带着原因 */
export default defineEventHandler(async (event): Promise<RagStatus> => {
  await requireAdmin(event)
  const stats = await syncRagIndex()
  return { ...(await ragStatus()), lastStats: stats }
})
