import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, baseUrl, db, questionId } from './helpers'

/** 网站上创建令牌（用登录的会话） */
async function createToken(c: Client, scope: 'read' | 'write', expiresInDays = 90) {
  const res = await c.json('/api/tokens', { body: { name: `测试 ${scope}`, scope, expiresInDays } })
  expect(res.status).toBe(200)
  return res.data as { id: number; token: string; prefix: string; scope: string }
}

/** 用官方 TypeScript SDK 的客户端连接，和 Claude Code、Cursor 用的是同一套协议实现 */
async function connect(token: string) {
  const client = new McpClient({ name: 'handbook-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl()}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

const text = (result: any) => (result.content as { type: string; text: string }[]).map((c) => c.text).join('\n')

/** 直接发 HTTP 请求，测传输层的边界情况 */
const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl()}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('访问令牌', () => {
  it('创建时返回一次明文，列表里只有前缀；只能撤销自己的', async () => {
    const c = new Client()
    await c.register('token')
    const created = await createToken(c, 'read', 30)
    expect(created.token).toMatch(/^mbk_[\w-]{40}$/)
    expect(created.prefix).toBe(created.token.slice(0, 12))

    const list = (await c.json('/api/tokens')).data as any[]
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: created.id, prefix: created.prefix, scope: 'read', lastUsedAt: null })
    expect(JSON.stringify(list)).not.toContain(created.token)
    // 30 天后过期
    expect(new Date(list[0].expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000)

    const [[row]] = await db().query<any[]>('SELECT token_hash FROM api_tokens WHERE id = ?', [created.id])
    expect(row.token_hash).toHaveLength(64)
    expect(row.token_hash).not.toContain(created.token.slice(4))

    const other = new Client()
    await other.register('tokenother')
    expect((await other.request(`/api/tokens/${created.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await c.request(`/api/tokens/${created.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await c.json('/api/tokens')).data).toEqual([])
    expect((await new Client().request('/api/tokens')).status).toBe(401)
    expect((await c.request('/api/tokens', { body: { name: 'x', scope: 'admin' } })).status).toBe(400)
  })
})

describe('MCP Server', () => {
  let c: Client
  let userId: number
  let writeToken: string
  let readToken: string

  beforeAll(async () => {
    // 先把问手册的检索索引建好，检索结果才稳定
    const admin = new Client()
    const u = await admin.register('mcpadmin')
    await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [u.id])
    await admin.json('/api/admin/rag/sync', { method: 'POST' })

    c = new Client()
    userId = (await c.register('mcp')).id
    writeToken = (await createToken(c, 'write')).token
    readToken = (await createToken(c, 'read')).token
  })

  it('官方客户端能连上：协议版本协商、服务说明、工具和提示词列表', async () => {
    const client = await connect(writeToken)
    expect(client.getServerVersion()).toMatchObject({ name: 'mianbook', version: '1.0.0' })
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, prompts: {} })
    expect(client.getInstructions()).toContain('search_handbook')

    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual([
      'search_handbook',
      'find_questions',
      'get_question',
      'pick_quiz_questions',
      'get_learning_profile',
      'get_due_reviews',
      'record_result',
    ])
    expect(tools.find((t) => t.name === 'record_result')!.annotations).toMatchObject({ readOnlyHint: false })
    expect(tools.find((t) => t.name === 'search_handbook')!.annotations).toMatchObject({ readOnlyHint: true })

    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name)).toEqual(['quiz', 'review_today', 'explain'])
    const quiz = await client.getPrompt({ name: 'quiz', arguments: { topic: 'Redis', count: '2' } })
    expect((quiz.messages[0]!.content as any).text).toContain('「Redis」方向的题，一共 2 道')
    await client.close()
  })

  it('检索手册、找题、看题：返回题目链接和用户自己的学习记录', async () => {
    const client = await connect(writeToken)
    const found = text(await client.callTool({ name: 'search_handbook', arguments: { query: '缓存穿透 布隆过滤器', limit: 3 } }))
    expect(found).toMatch(/^找到 3 段相关内容/)
    expect(found).toContain(`${baseUrl()}/basics/redis/01-cache-problems`)

    const list = text(await client.callTool({ name: 'find_questions', arguments: { category: 'Redis', difficulty: 2, limit: 3 } }))
    expect(list).toMatch(/^找到 3 道题/)
    expect(list).toContain('掌握程度：没学过')

    const id = await questionId('01-cache-problems', 'redis')
    await db().query("INSERT INTO study_records (user_id, question_id, status, starred, note) VALUES (?, ?, 'fuzzy', 1, '布隆过滤器要再看')", [userId, id])
    const detail = text(await client.callTool({ name: 'get_question', arguments: { question_id: id } }))
    expect(detail).toMatch(/^# 缓存穿透、缓存击穿、缓存雪崩分别是什么？怎么解决？/)
    expect(detail).toContain('我的掌握程度：模糊（已收藏）')
    expect(detail).toContain('我的笔记：布隆过滤器要再看')
    expect(detail).toContain('::: tip 一句话回答')

    // 工具出错时返回 isError，模型能看到原因
    const missing = await client.callTool({ name: 'get_question', arguments: { question_id: 99_999_999 } })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('不存在')
    const badCategory = await client.callTool({ name: 'find_questions', arguments: { category: '量子计算' } })
    expect(badCategory.isError).toBe(true)
    expect(text(badCategory)).toContain('可用的分类有')
    const badArgs = await client.callTool({ name: 'search_handbook', arguments: {} })
    expect(badArgs.isError).toBe(true)
    await client.close()
  })

  it('抽题考我：记录得分写进复习计划，今日复习里能看到', async () => {
    const client = await connect(writeToken)
    const picked = text(await client.callTool({ name: 'pick_quiz_questions', arguments: { category: 'Redis', count: 2 } }))
    const ids = [...picked.matchAll(/\[id (\d+)\]/g)].map((m) => Number(m[1]))
    expect(ids).toHaveLength(2)
    expect(picked).not.toContain('一句话回答')

    const recorded = text(await client.callTool({ name: 'record_result', arguments: { question_id: ids[0], score: 3 } }))
    expect(recorded).toMatch(/^已记录「.+」3\/10 分，下次复习 \d{4}-\d{2}-\d{2}，已标记为"不会"。$/)
    const [[log]] = await db().query<any[]>('SELECT rating, source FROM review_logs WHERE user_id = ? AND question_id = ?', [userId, ids[0]])
    expect(log).toEqual({ rating: 1, source: 'mcp' })

    expect(text(await client.callTool({ name: 'get_due_reviews', arguments: {} }))).toMatch(/^今天没有要复习的题/)
    await db().query('UPDATE review_cards SET due = UTC_TIMESTAMP() - INTERVAL 2 DAY WHERE user_id = ? AND question_id = ?', [userId, ids[0]])
    const due = text(await client.callTool({ name: 'get_due_reviews', arguments: {} }))
    expect(due).toMatch(/^今天要复习 1 道题/)
    expect(due).toContain(`[id ${ids[0]}]`)
    expect(due).toContain('已逾期')

    const profile = text(await client.callTool({ name: 'get_learning_profile', arguments: {} }))
    expect(profile).toContain('今天要复习 1 道题')
    // 抽到的第一题可能就是前面标成"模糊"的那道，所以只看有没有"不会"
    expect(profile).toMatch(/- Redis：共 \d+ 题，掌握 \d+、模糊 \d+、不会 [1-9]/)
    await client.close()
  })

  it('只读令牌：看不到也调用不了写入的工具', async () => {
    const client = await connect(readToken)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).not.toContain('record_result')
    const denied = await client.callTool({ name: 'record_result', arguments: { question_id: 1, score: 9 } })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('只读')
    await client.close()
  })

  it('传输层：鉴权、来源、方法、协议版本、格式错误、通知', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'ping' }
    const noToken = await post(init)
    expect(noToken.status).toBe(401)
    expect(noToken.headers.get('www-authenticate')).toContain('Bearer')
    expect((await post(init, { Authorization: 'Bearer mbk_' + 'x'.repeat(40) })).status).toBe(401)

    const auth = { Authorization: `Bearer ${writeToken}` }
    expect(await (await post(init, auth)).json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    expect((await post(init, { ...auth, Origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(init, { ...auth, 'MCP-Protocol-Version': '1999-01-01' })).status).toBe(400)
    expect((await post('{"jsonrpc":', auth)).status).toBe(400)
    // 通知没有响应正文
    const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, auth)
    expect(notified.status).toBe(202)
    expect(await notified.text()).toBe('')
    // 兼容旧版本的批量请求
    const batch = await (await post([init, { ...init, id: 2 }], auth)).json()
    expect(batch.map((r: any) => r.id)).toEqual([1, 2])

    const get = await fetch(`${baseUrl()}/mcp`, { headers: { Accept: 'text/event-stream', ...auth } })
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    const browser = await fetch(`${baseUrl()}/mcp`, { headers: { Accept: 'text/html' }, redirect: 'manual' })
    expect(browser.status).toBe(302)
    expect(browser.headers.get('location')).toBe('/connect')
  })

  it('令牌过期或撤销后立刻失效；用过之后记录最近使用时间', async () => {
    const [[used]] = await db().query<any[]>('SELECT last_used_at FROM api_tokens WHERE user_id = ? AND scope = ?', [userId, 'write'])
    expect(used.last_used_at).not.toBeNull()

    const temp = await createToken(c, 'read')
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${temp.token}` })).status).toBe(200)
    await db().query('UPDATE api_tokens SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = ?', [temp.id])
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${temp.token}` })).status).toBe(401)

    const revoked = await createToken(c, 'read')
    const client = await connect(revoked.token)
    await c.request(`/api/tokens/${revoked.id}`, { method: 'DELETE' })
    await expect(client.listTools()).rejects.toMatchObject({ code: 401 })
  })

  it('每个令牌每分钟最多 60 次请求', async () => {
    const limited = await createToken(c, 'read')
    const headers = { Authorization: `Bearer ${limited.token}` }
    const statuses = await Promise.all(Array.from({ length: 61 }, (_, i) => post({ jsonrpc: '2.0', id: i, method: 'ping' }, headers).then((r) => r.status)))
    expect(statuses.filter((s) => s === 200)).toHaveLength(60)
    expect(statuses.filter((s) => s === 429)).toHaveLength(1)
  })

  afterAll(async () => {
    await db().query('DELETE FROM api_tokens WHERE user_id = ?', [userId])
  })
})
