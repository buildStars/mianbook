import { and, count, eq, gte, notLike } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { AI_HEADERS, AI_PROVIDERS } from '#shared/utils/ai-providers'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
}

/** 一次调用用到的模型配置：site 是站点在 .env 里配的，user 是用户在浏览器里填的自己的 Key */
export interface AiTarget {
  source: 'site' | 'user'
  baseUrl: string
  apiKey: string
  model: string
}

export function aiConfig() {
  const { ai } = useRuntimeConfig()
  return {
    baseUrl: String(ai.baseUrl || '').replace(/\/+$/, ''),
    apiKey: String(ai.apiKey || ''),
    model: String(ai.model || ''),
    dailyLimit: Number(ai.dailyLimit) || 30,
    extraHosts: String(ai.extraHosts || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  }
}

export function siteTarget(): AiTarget {
  const { baseUrl, apiKey, model } = aiConfig()
  return { source: 'site', baseUrl, apiKey, model }
}

/** 用户自带 Key 时允许请求的域名：预设服务商 + .env 里 NUXT_AI_EXTRA_HOSTS 追加的 */
export function allowedUserHosts(): string[] {
  const hosts = new Set(AI_PROVIDERS.map((p) => new URL(p.baseUrl).hostname))
  for (const h of aiConfig().extraHosts) hosts.add(h)
  return [...hosts]
}

/**
 * 读取请求头里用户自己的 AI 配置。没有带 Key 时返回 null，使用站点配置。
 * Base URL 只能是 https 且域名在白名单里，防止借服务器去请求内网地址（SSRF）
 */
export function userTarget(event: H3Event): AiTarget | null {
  const apiKey = getHeader(event, AI_HEADERS.apiKey)?.trim()
  if (!apiKey) return null
  const rawBase = getHeader(event, AI_HEADERS.baseUrl)?.trim() ?? ''
  const model = getHeader(event, AI_HEADERS.model)?.trim() ?? ''

  let url: URL
  try {
    url = new URL(rawBase)
  } catch {
    throw createError({ statusCode: 400, message: 'AI 设置里的 Base URL 格式不对' })
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowedUserHosts().includes(url.hostname)) {
    throw createError({ statusCode: 400, message: `不支持这个 AI 服务地址：${url.host}，请从列表里选择服务商` })
  }
  if (!model || model.length > 128 || !/^[\w.:/@-]+$/.test(model)) {
    throw createError({ statusCode: 400, message: '请在 AI 设置里填写正确的模型名' })
  }
  if (apiKey.length > 512 || /\s/.test(apiKey)) {
    throw createError({ statusCode: 400, message: 'API Key 格式不对' })
  }
  return { source: 'user', baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, ''), apiKey, model }
}

/** 最近 24 小时内用站点 Key 的调用次数（滚动窗口，不受时区影响）；用户自己的 Key 记为 xxx-own，不计入 */
export async function aiUsageToday(userId: number): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [row] = await useDb()
    .select({ total: count() })
    .from(tables.aiCalls)
    .where(and(eq(tables.aiCalls.userId, userId), notLike(tables.aiCalls.kind, '%-own'), gte(tables.aiCalls.createdAt, since)))
  return row?.total ?? 0
}

export class AiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** 把上游的报错翻译成用户能看懂的提示；按配置来源提示去哪里改 */
async function toAiError(res: Response, target: AiTarget): Promise<AiError> {
  let detail = ''
  try {
    const body = await res.json()
    detail = String(body?.error?.message ?? body?.message ?? '').slice(0, 200)
  } catch {
    // 响应体不是 JSON
  }
  const own = target.source === 'user'
  if (res.status === 401 || res.status === 403) {
    return new AiError(res.status, own ? '你的 API Key 无效或没有权限，请在 AI 设置里检查' : 'AI 服务的 API Key 无效或没有权限，请检查 NUXT_AI_API_KEY')
  }
  if (res.status === 404 || /model/i.test(detail)) {
    const where = own ? '请在 AI 设置里换一个模型' : '请检查 NUXT_AI_MODEL'
    return new AiError(res.status, `模型 ${target.model} 不可用，${where}（${detail || res.status}）`)
  }
  if (res.status === 402 || res.status === 429) {
    return new AiError(res.status, own ? '你的账户余额不足或请求太频繁，请稍后再试' : 'AI 服务繁忙或额度不足，请稍后再试')
  }
  return new AiError(res.status, `AI 服务出错（${res.status}）${detail ? `：${detail}` : ''}`)
}

export function describeAiError(error: unknown, target?: AiTarget): string {
  if (error instanceof AiError) return error.message
  if (error instanceof Error && error.name === 'TimeoutError') return 'AI 服务响应超时，请稍后再试'
  return target?.source === 'user' ? '连接 AI 服务失败，请检查网络和 AI 设置' : '连接 AI 服务失败，请检查网络和 NUXT_AI_BASE_URL'
}

/** 调用 OpenAI 兼容的 /chat/completions 流式接口，逐段产出文本 */
export async function* streamChat(
  target: AiTarget,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<{ delta?: string; usage?: ChatUsage }> {
  const res = await fetch(`${target.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
    body: JSON.stringify({ model: target.model, messages, stream: true, max_tokens: 2048 }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    redirect: 'error',
  })
  if (!res.ok || !res.body) throw await toAiError(res, target)

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let newline: number
    // 一条数据可能被拆在两个网络包里，只处理已经完整的行
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      let chunk: any
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      const delta = chunk.choices?.[0]?.delta?.content
      const usage = chunk.usage ?? chunk.choices?.[0]?.usage
      if (delta) yield { delta }
      if (usage) yield { usage }
    }
  }
}

/** 列出可用模型；有的服务商没有这个接口，调用方要处理失败 */
export async function listModels(target: AiTarget): Promise<string[]> {
  const res = await fetch(`${target.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${target.apiKey}` },
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  })
  if (!res.ok) throw await toAiError(res, target)
  const body = await res.json()
  return (body?.data ?? []).map((m: { id: string }) => m.id).sort()
}

/** 发一条极短的请求，确认 Key 和模型都能用 */
export async function pingModel(target: AiTarget): Promise<void> {
  const res = await fetch(`${target.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
    body: JSON.stringify({ model: target.model, messages: [{ role: 'user', content: '回复"好"' }], max_tokens: 8 }),
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  if (!res.ok) throw await toAiError(res, target)
}

/** 确定这次调用用谁的 Key：请求头里带了用户自己的 Key 就用它（不限次数），否则用站点的 Key 并检查每日次数 */
export async function resolveAi(event: H3Event, userId: number) {
  const { dailyLimit } = aiConfig()
  const target = userTarget(event) ?? siteTarget()
  const ownKey = target.source === 'user'
  if (!ownKey && !target.apiKey) {
    throw createError({ statusCode: 503, message: '站点没有配置 AI 服务，请在 AI 设置里填写你自己的 API Key' })
  }
  const used = ownKey ? 0 : await aiUsageToday(userId)
  if (!ownKey && used >= dailyLimit) {
    throw createError({
      statusCode: 429,
      message: `24 小时内的 AI 次数已用完（${dailyLimit} 次），可以稍后再来，或在 AI 设置里填写自己的 API Key`,
    })
  }
  /** 这次调用之后还剩几次；用自己的 Key 时为 null */
  const remaining = ownKey ? null : Math.max(0, dailyLimit - used - 1)
  return { target, ownKey, remaining }
}

/** 记一次大模型调用；用自己 Key 的记成 xxx-own，不占站点的每日次数 */
export function recordAiCall(userId: number, kind: 'interview' | 'report' | 'resume', ownKey: boolean, usage?: ChatUsage) {
  return useDb()
    .insert(tables.aiCalls)
    .values({
      userId,
      kind: ownKey ? `${kind}-own` : kind,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
    })
    .catch(() => {})
}

/** 非流式调用一次，返回完整文本；用于出题这类不需要边生成边显示的场景 */
export async function chatOnce(
  target: AiTarget,
  messages: ChatMessage[],
  options: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<{ text: string; usage?: ChatUsage }> {
  const res = await fetch(`${target.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
    body: JSON.stringify({ model: target.model, messages, stream: false, max_tokens: options.maxTokens ?? 2048 }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    redirect: 'error',
  })
  if (!res.ok) throw await toAiError(res, target)
  const body = await res.json()
  return { text: String(body?.choices?.[0]?.message?.content ?? ''), usage: body?.usage }
}
