import { eq, max } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readValidated(event, questionSchema)
  const db = useDb()

  const [category] = await db.select().from(tables.categories).where(eq(tables.categories.id, body.categoryId))
  if (!category) throw createError({ statusCode: 400, message: '分类不存在' })

  // 没有指定排序时排在分类最后
  let sort = body.sort
  if (sort === undefined) {
    const [row] = await db
      .select({ value: max(tables.questions.sort) })
      .from(tables.questions)
      .where(eq(tables.questions.categoryId, body.categoryId))
    sort = (row?.value ?? 0) + 10
  }

  const rendered = await renderMarkdown(body.contentMd)
  try {
    const [created] = await db
      .insert(tables.questions)
      .values({
        ...body,
        sort,
        contentHtml: rendered.html,
        contentText: rendered.text,
        toc: rendered.toc,
      })
      .$returningId()
    invalidateContent()
    // 写回 content/ 下的 Markdown，保持文件和数据库一致
    const sync = await writeQuestionFile(created!.id)
    return { id: created!.id, sync }
  } catch (error) {
    if (isDuplicateError(error)) throw createError({ statusCode: 409, message: '这个分类下已经有相同 slug 的题目' })
    throw error
  }
})
