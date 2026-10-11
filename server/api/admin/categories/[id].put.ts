import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  partId: z.number().int().positive('请选择所属部分'),
  slug: slugSchema,
  title: z.string().trim().min(1, '请填写名称').max(64),
  sort: z.number().int().min(0),
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = idParam(event)
  const body = await readValidated(event, schema)
  try {
    await useDb().update(tables.categories).set(body).where(eq(tables.categories.id, id))
  } catch (error) {
    if (isDuplicateError(error)) throw createError({ statusCode: 409, message: '这个部分下已经有相同 slug 的分类' })
    throw error
  }
  invalidateContent()
  return { id }
})
