import { z } from 'zod'

const schema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1, '请填写名称').max(64),
  sort: z.number().int().min(0).default(0),
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readValidated(event, schema)
  try {
    const [created] = await useDb().insert(tables.parts).values(body).$returningId()
    invalidateContent()
    return { id: created!.id, sync: await writeOutlineFile() }
  } catch (error) {
    if (isDuplicateError(error)) throw createError({ statusCode: 409, message: '已经有相同 slug 的部分' })
    throw error
  }
})
