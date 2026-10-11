import { asc, eq, inArray, max } from 'drizzle-orm'
import { z } from 'zod'
import type { SyncResult } from '../../../utils/content-sync'

const ids = z.array(z.number().int().positive()).min(1, '请选择题目').max(200, '一次最多处理 200 道题')
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['publish', 'draft', 'delete']), ids }),
  z.object({ action: z.literal('move'), ids, categoryId: z.number().int().positive('请选择分类') }),
])

/** 批量发布、转草稿、移动分类、删除；每道题单独处理，一道失败不影响其他的 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidated(event, schema)
  const db = useDb()
  const q = tables.questions
  const unique = [...new Set(body.ids)]

  // 按目录顺序处理，移动后的题目保持原来的先后
  const rows = await db
    .select({ id: q.id, title: q.title, status: q.status, categoryId: q.categoryId, sort: q.sort })
    .from(q)
    .innerJoin(tables.categories, eq(tables.categories.id, q.categoryId))
    .where(inArray(q.id, unique))
    .orderBy(asc(tables.categories.partId), asc(tables.categories.sort), asc(q.sort), asc(q.id))

  const syncs: SyncResult[] = []
  const failed: { id: number; title: string; message: string }[] = []
  let changed = 0

  if (body.action === 'publish' || body.action === 'draft') {
    const status = body.action === 'publish' ? 'published' : 'draft'
    for (const row of rows) {
      if (row.status === status) continue
      const before = await questionSnapshot(row.id)
      await db.update(q).set({ status }).where(eq(q.id, row.id))
      await recordVersion(row.id, admin.id, before)
      syncs.push(await writeQuestionFile(row.id))
      changed++
    }
  } else if (body.action === 'move') {
    const [category] = await db.select().from(tables.categories).where(eq(tables.categories.id, body.categoryId))
    if (!category) throw createError({ statusCode: 400, message: '分类不存在' })
    const [top] = await db.select({ value: max(q.sort) }).from(q).where(eq(q.categoryId, body.categoryId))
    let sort = top?.value ?? 0
    for (const row of rows) {
      if (row.categoryId === body.categoryId) continue
      const previous = await questionFileLocation(row.id)
      try {
        // 排在目标分类的最后
        await db.update(q).set({ categoryId: body.categoryId, sort: sort + 10 }).where(eq(q.id, row.id))
      } catch (error) {
        if (!isDuplicateError(error)) throw error
        failed.push({ id: row.id, title: row.title, message: '目标分类里已经有相同 slug 的题目' })
        continue
      }
      sort += 10
      syncs.push(await writeQuestionFile(row.id, previous))
      changed++
    }
  } else {
    for (const row of rows) {
      const previous = await questionFileLocation(row.id)
      await db.delete(q).where(eq(q.id, row.id))
      syncs.push(await removeQuestionFile(previous))
      changed++
    }
  }

  if (changed) invalidateContent()
  const syncError = syncs.find((s) => s.error)?.error
  return {
    changed,
    /** 本来就是目标状态、或者已经不存在的题目 */
    skipped: unique.length - changed - failed.length,
    failed,
    sync: { synced: syncs.length > 0 && syncs.every((s) => s.synced), ...(syncError ? { error: syncError } : {}) } as SyncResult,
  }
})
