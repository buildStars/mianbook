/** 结束面试：没答的题不计分，算出平均分 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const row = await getMockSession(user.id, idParam(event))
  if (row.status === 'finished') return sessionDetail(row)
  const score = sessionScore(row.items)
  const finishedAt = new Date()
  await saveItems(row.id, row.items, { status: 'finished', score, finishedAt })
  return sessionDetail({ ...row, status: 'finished', score, finishedAt })
})
