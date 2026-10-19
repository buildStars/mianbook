export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return adminUserRows()
})
