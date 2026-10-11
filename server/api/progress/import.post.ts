import { z } from 'zod'

const recordSchema = z.object({
  status: z.enum(['weak', 'fuzzy', 'mastered']).nullable().optional(),
  starred: z.boolean().optional(),
  // 旧版静态站导出的字段名
  star: z.boolean().optional(),
  note: z.string().max(5000).nullable().optional(),
  updatedAt: z.string().optional(),
  at: z.number().optional(),
})

const schema = z.object({
  records: z.record(z.string(), recordSchema),
})

/**
 * 合并学习记录。key 可以是题目 id，也可以是旧版静态站的页面路径（如 /basics/javascript/01-event-loop）。
 * 两边都有记录时，以更新时间较新的为准。
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { records } = await readValidated(event, schema)

  const outline = await getOutline()
  const byPath = new Map<string, number>()
  const ids = new Set<number>()
  for (const part of outline)
    for (const cat of part.categories)
      for (const q of cat.questions) {
        byPath.set(q.path, q.id)
        ids.add(q.id)
      }

  let imported = 0
  let skipped = 0
  for (const [key, record] of Object.entries(records)) {
    const id = /^\d+$/.test(key) ? Number(key) : byPath.get(key.replace(/\.html$/, ''))
    if (!id || !ids.has(id)) {
      skipped++
      continue
    }
    const incomingAt = record.updatedAt ? Date.parse(record.updatedAt) : (record.at ?? 0)
    const current = await getStudyRecord(user.id, id)
    if (current && current.updatedAt.getTime() > incomingAt) {
      skipped++
      continue
    }
    // 还没有复习计划的题，按导入的掌握程度加入计划
    if (record.status && !(await getReviewCard(user.id, id))) {
      await reviewQuestion(user.id, id, gradeFromStatus[record.status], 'page')
    }
    await saveStudyRecord(user.id, id, {
      status: record.status ?? null,
      starred: record.starred ?? record.star ?? false,
      note: record.note ?? null,
    })
    imported++
  }
  return { imported, skipped }
})
