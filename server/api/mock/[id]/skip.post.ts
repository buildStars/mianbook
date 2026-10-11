/** 跳过当前题：按"不会"处理，记 0 分，标记为不会并安排复习 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const row = await getMockSession(user.id, idParam(event))
  if (row.status !== 'active') throw createError({ statusCode: 400, message: '这场面试已经结束' })
  const item = row.items[row.currentIndex]
  if (!item || item.done) throw createError({ statusCode: 400, message: '这道题已经答完了' })

  // 已经答了几轮再跳过追问的，保留已有得分，不当作不会
  const answered = item.scores.length > 0
  const items = row.items.map((it, i) => (i === row.currentIndex ? { ...it, skipped: !answered, done: true } : it))
  // 按简历生成的题不在题库里，不进复习计划
  if (!answered && item.questionId !== null) {
    await reviewQuestion(user.id, item.questionId, 1, 'mock')
    const current = await getStudyRecord(user.id, item.questionId)
    await saveStudyRecord(user.id, item.questionId, { status: 'weak', starred: current?.starred ?? false, note: current?.note ?? null })
  }
  const last = row.currentIndex >= row.items.length - 1
  const currentIndex = last ? row.currentIndex : row.currentIndex + 1
  await saveItems(row.id, items, { currentIndex })
  return { currentIndex, last }
})
