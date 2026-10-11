import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = idParam(event)
  const body = await readValidated(event, questionSchema)
  const db = useDb()

  const [category] = await db.select().from(tables.categories).where(eq(tables.categories.id, body.categoryId))
  if (!category) throw createError({ statusCode: 400, message: '分类不存在' })

  const rendered = await renderMarkdown(body.contentMd)
  try {
    const [result] = await db
      .update(tables.questions)
      .set({
        ...body,
        contentHtml: rendered.html,
        contentText: rendered.text,
        toc: rendered.toc,
      })
      .where(eq(tables.questions.id, id))
    if (!result.affectedRows) throw createError({ statusCode: 404, message: '题目不存在' })
  } catch (error) {
    if (isDuplicateError(error)) throw createError({ statusCode: 409, message: '这个分类下已经有相同 slug 的题目' })
    throw error
  }
  invalidateContent()
  return { id }
})
