export default defineEventHandler(async (event) => {
  const path = `/${getRouterParam(event, 'path') ?? ''}`
  const detail = await getQuestionDetail(path)
  if (!detail) throw createError({ statusCode: 404, message: '题目不存在或还没有发布' })
  return detail
})
