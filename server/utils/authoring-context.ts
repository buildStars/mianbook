import { and, asc, desc, eq, ne } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AuthoringContext } from './authoring'
import type { ChatMessage, ChatUsage } from './ai'

/** 写作规范 templates/writing-guide.md，构建时作为服务端资源打包 */
export async function loadWritingGuide(): Promise<string> {
  const raw = await useStorage('assets:templates').getItem('writing-guide.md')
  const guide = typeof raw === 'string' ? raw : raw ? new TextDecoder().decode(raw as Uint8Array) : ''
  if (!guide) throw createError({ statusCode: 500, message: '没有找到写作规范 templates/writing-guide.md' })
  return guide
}

/** 分类信息和同分类的题目；example 是一道篇幅居中的已发布题目，用作写法参考 */
export async function authoringContext(categoryId: number, excludeId?: number): Promise<AuthoringContext & { example?: string }> {
  const db = useDb()
  const { questions: q, categories: c, parts: p } = tables
  const [cat] = await db
    .select({ title: c.title, slug: c.slug, partTitle: p.title, partSlug: p.slug })
    .from(c)
    .innerJoin(p, eq(p.id, c.partId))
    .where(eq(c.id, categoryId))
  if (!cat) throw createError({ statusCode: 400, message: '分类不存在' })

  const rows = await db
    .select({ id: q.id, title: q.title, slug: q.slug, status: q.status, contentMd: q.contentMd })
    .from(q)
    .where(excludeId ? and(eq(q.categoryId, categoryId), ne(q.id, excludeId)) : eq(q.categoryId, categoryId))
    .orderBy(asc(q.sort), asc(q.id))

  const published = rows.filter((r) => r.status === 'published').sort((a, b) => a.contentMd.length - b.contentMd.length)
  return {
    part: cat.partTitle,
    category: cat.title,
    siblings: rows.map((r) => ({ title: r.title, path: `/${cat.partSlug}/${cat.slug}/${r.slug}` })),
    example: published[Math.floor(published.length / 2)]?.contentMd,
  }
}

/** 这道题最近的 AI 面试：第一轮的得分和点评里指出的遗漏。只取 AI 的点评，不把用户的原始回答发给模型 */
export async function interviewFeedback(questionId: number, limit = 20) {
  const rows = await useDb()
    .select({ turns: tables.interviews.turns })
    .from(tables.interviews)
    .where(eq(tables.interviews.questionId, questionId))
    .orderBy(desc(tables.interviews.id))
    .limit(limit)
  return rows
    .map((r) => r.turns[0])
    .filter((t) => t?.feedback)
    .map((t) => ({ score: t!.score, missing: missingPart(t!.feedback) }))
}

/** 后台写题用谁的 Key：管理员在浏览器里填了自己的 Key 就用它，否则用站点的 Key；不占每日次数 */
export function authorTarget(event: H3Event) {
  const target = userTarget(event) ?? siteTarget()
  if (!target.apiKey) {
    throw createError({ statusCode: 503, message: '站点没有配置 AI Key：在 .env 里填写 NUXT_AI_API_KEY，或者在前台的 AI 设置里填自己的 Key' })
  }
  return { target, ownKey: target.source === 'user' }
}

/**
 * 把模型的输出用 SSE 转发给浏览器。事件：delta（片段）、done、error。
 * 整道题输出较长，放宽 token 上限和超时；浏览器断开时同时中断对模型的请求
 */
export function streamAuthoring(event: H3Event, userId: number, ai: ReturnType<typeof authorTarget>, messages: ChatMessage[]) {
  const stream = createEventStream(event)
  const controller = new AbortController()
  stream.onClosed(() => controller.abort())
  const send = (name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) })

  ;(async () => {
    let text = ''
    let usage: ChatUsage | undefined
    try {
      for await (const part of streamChat(ai.target, messages, controller.signal, { maxTokens: 8192, timeoutMs: 300_000 })) {
        if (part.delta) {
          text += part.delta
          await send('delta', { text: part.delta })
        }
        if (part.usage) usage = part.usage
      }
      if (!text.trim()) throw new AiError(502, 'AI 没有返回内容，请重试')
      await send('done', { length: text.length })
    } catch (error) {
      if (!controller.signal.aborted) await send('error', { message: describeAiError(error, ai.target) })
    } finally {
      if (text) await recordAiCall(userId, 'author', ai.ownKey, usage)
      await stream.close()
    }
  })()

  return stream.send()
}
