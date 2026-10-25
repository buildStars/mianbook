/** 一道默写练习：要求、提示、起始代码、测试和参考答案；路径和题目一样 */
export default defineEventHandler(async (event) => {
  const practice = await getPractice(`/${getRouterParam(event, 'path') ?? ''}`)
  if (!practice) throw createError({ statusCode: 404, message: '这道题还没有默写练习' })
  return practice
})
