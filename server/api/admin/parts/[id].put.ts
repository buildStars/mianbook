import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1, '请填写名称').max(64),
  sort: z.number().int().min(0),
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = idParam(event)
  const body = await readValidated(event, schema)
  const [before] = await useDb().select({ slug: tables.parts.slug }).from(tables.parts).where(eq(tables.parts.id, id))
  try {
    await useDb().update(tables.parts).set(body).where(eq(tables.parts.id, id))
  } catch (error) {
    if (isDuplicateError(error)) throw createError({ statusCode: 409, message: '已经有相同 slug 的部分' })
    throw error
  }
  invalidateContent()
  // 改了 slug 时把整个部分的文件夹挪过去
  const moves = before && before.slug !== body.slug ? [{ from: before.slug, to: body.slug }] : []
  return { id, sync: await writeOutlineFile(moves) }
})
