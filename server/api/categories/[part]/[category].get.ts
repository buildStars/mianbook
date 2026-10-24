export default defineEventHandler(async (event) => {
  const detail = await getCategoryDetail(getRouterParam(event, 'part') ?? '', getRouterParam(event, 'category') ?? '')
  if (!detail) throw createError({ statusCode: 404, message: '分类不存在' })
  return detail
})
