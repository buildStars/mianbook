/** 当前题答完后进入下一题 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const row = await getMockSession(user.id, idParam(event))
  if (row.status !== 'active') throw createError({ statusCode: 400, message: '这场面试已经结束' })
  if (!row.items[row.currentIndex]?.done) throw createError({ statusCode: 400, message: '这道题还没有答完' })
  const currentIndex = Math.min(row.currentIndex + 1, row.items.length - 1)
  await saveItems(row.id, row.items, { currentIndex })
  return { currentIndex }
})
