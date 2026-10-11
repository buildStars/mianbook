/**
 * 检查用户自己的 AI 配置（Key 放在请求头里，服务端不保存）：
 * 先发一条极短的请求确认 Key 和模型可用，再尽量拉一下模型列表方便选择
 */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const target = userTarget(event)
  if (!target) throw createError({ statusCode: 400, message: '请先填写 API Key' })

  let models: string[] = []
  try {
    models = await listModels(target)
  } catch {
    // 有的服务商没有 /models 接口，不影响使用
  }
  try {
    await pingModel(target)
    return { ok: true, message: '连接正常，可以开始面试', models }
  } catch (error) {
    return { ok: false, message: describeAiError(error, target), models }
  }
})
