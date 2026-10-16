import { afterAll, describe, expect, inject, it } from 'vitest'
import { Client, db, lastLlmRequest } from './helpers'

async function admin() {
  const c = new Client()
  const u = await c.register('ragadmin')
  await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [u.id])
  return c
}

const mock = (path: string) => fetch(new URL(inject('mockUrl')).origin + path)

const sync = async (c: Client) => (await c.json('/api/admin/rag/sync', { method: 'POST' })).data

async function categoryId(part: string, slug: string) {
  const [[row]] = await db().query<any[]>(
    'SELECT c.id FROM categories c JOIN parts p ON p.id = c.part_id WHERE p.slug = ? AND c.slug = ?',
    [part, slug],
  )
  return row.id as number
}

const CONTENT = [
  '::: tip 一句话回答',
  '量子纠缠缓存协议是测试用的虚构概念。',
  ':::',
  '',
  '## 详细解析',
  '',
  '第一段解析。',
  '',
  '## 易错点',
  '',
  '- 不要和真实的缓存协议混淆',
].join('\n')

describe('问手册的检索索引', () => {
  let c: Client
  let id: number | undefined

  afterAll(async () => {
    if (id) await c.request(`/api/admin/questions/${id}`, { method: 'DELETE' })
  })

  it('启动后把所有已发布的题切块并生成向量；没变化时再同步什么都不做', async () => {
    c = await admin()
    const status = await sync(c)
    const [[published]] = await db().query<any[]>("SELECT COUNT(*) AS n FROM questions WHERE status = 'published'")
    expect(status.questions).toBe(published.n)
    expect(status.chunks).toBeGreaterThan(published.n * 3)
    expect(status.embedded).toBe(status.chunks)
    expect(status.embed).toMatchObject({ model: 'mock-embed' })

    const again = await sync(c)
    expect(again.lastStats).toMatchObject({ questionsChanged: 0, questionsRemoved: 0, embedded: 0, error: null })
  })

  it('改题后只给变了的块重新生成向量，下线后移出索引', async () => {
    const js = await categoryId('basics', 'javascript')
    const body = { categoryId: js, slug: '98-rag-test', title: '量子纠缠缓存协议是什么？', difficulty: 2, tags: ['测试'], contentMd: CONTENT, status: 'published' }
    const created = await c.json('/api/admin/questions', { body })
    expect(created.status).toBe(200)
    id = created.data.id

    let status = await sync(c)
    expect(status.lastStats).toMatchObject({ questionsChanged: 1, embedded: 3, reused: 0 })
    let found = (await c.json(`/api/admin/rag/search?q=${encodeURIComponent('量子纠缠缓存协议')}`)).data
    expect(found.hits[0]).toMatchObject({ questionId: id, keywordRank: 1, heading: '一句话回答' })

    // 只改"详细解析"一节：另外两块沿用旧向量
    const before = (await (await mock('/__embeds')).json()).embedded
    await c.json(`/api/admin/questions/${id}`, { method: 'PUT', body: { ...body, contentMd: CONTENT.replace('第一段解析。', '改过的解析。') } })
    status = await sync(c)
    expect(status.lastStats).toMatchObject({ questionsChanged: 1, embedded: 1, reused: 2 })
    expect((await (await mock('/__embeds')).json()).embedded - before).toBe(1)

    await c.json(`/api/admin/questions/${id}`, { method: 'PUT', body: { ...body, status: 'draft' } })
    status = await sync(c)
    expect(status.lastStats).toMatchObject({ questionsRemoved: 1 })
    found = (await c.json(`/api/admin/rag/search?q=${encodeURIComponent('量子纠缠缓存协议')}`)).data
    expect(found.hits.some((h: any) => h.questionId === id)).toBe(false)
  })

  it('检索调试显示两路排名；普通用户不能用', async () => {
    const { data } = await c.json(`/api/admin/rag/search?q=${encodeURIComponent('缓存穿透 布隆过滤器')}`)
    expect(data.mode).toBe('hybrid')
    expect(data.hits.length).toBe(10)
    expect(data.hits[0].path).toBe('/basics/redis/01-cache-problems')
    expect(data.hits[0].keywordRank).not.toBeNull()
    expect(data.hits[0].vectorRank).not.toBeNull()
    expect(data.hits.every((h: any, i: number) => h.rank === i + 1)).toBe(true)

    const user = new Client()
    await user.register('ragnormal')
    expect((await user.request('/api/admin/rag/search?q=x')).status).toBe(403)
    expect((await user.request('/api/admin/rag/sync', { method: 'POST', body: {} })).status).toBe(403)
  })

  it('向量接口出错时退化为关键词检索', async () => {
    await mock('/__embed-down?on=1')
    try {
      const { data } = await c.json(`/api/admin/rag/search?q=${encodeURIComponent('布隆过滤器的误判率怎么算 down')}`)
      expect(data.mode).toBe('keyword')
      expect(data.warning).toContain('500')
      expect(data.hits.length).toBeGreaterThan(0)
    } finally {
      await mock('/__embed-down?on=0')
    }
  })
})

describe('问手册', () => {
  it('未登录不能问；问题太短返回 400', async () => {
    expect((await new Client().request('/api/ask', { body: { question: '缓存穿透' } })).status).toBe(401)
    const c = new Client()
    await c.register('askshort')
    expect((await c.request('/api/ask', { body: { question: '啊' } })).status).toBe(400)
  })

  it('先返回资料，再流式返回回答，最后给出引用的编号', async () => {
    const c = new Client()
    await c.register('ask')
    const res = await c.sse('/api/ask', { question: '缓存穿透怎么解决？布隆过滤器有什么缺点？' })
    expect(res.status).toBe(200)
    expect(res.events[0]!.event).toBe('sources')
    const sources = res.events[0]!.data.sources
    expect(sources.length).toBe(6)
    expect(sources.map((s: any) => s.n)).toEqual([1, 2, 3, 4, 5, 6])
    expect(sources.some((s: any) => s.path === '/basics/redis/01-cache-problems')).toBe(true)
    expect(res.text).toContain('布隆过滤器或缓存空值[1]')
    // [99] 超出了资料的范围，不算引用
    expect(res.done).toEqual({ citations: [1, 2], remaining: inject('dailyLimit') - 1 })

    // 发给模型的：系统提示 + 带编号的资料和问题
    const sent = await lastLlmRequest()
    expect(sent.messages[0].content).toContain('问答助手')
    const last = sent.messages.at(-1).content as string
    expect(last.startsWith('【资料】\n[1] 《')).toBe(true)
    expect(last).toContain(`[6] 《`)
    expect(last.endsWith('【问题】\n缓存穿透怎么解决？布隆过滤器有什么缺点？')).toBe(true)

    const [[call]] = await db().query<any[]>(
      'SELECT kind FROM ai_calls a JOIN users u ON u.id = a.user_id WHERE u.name = ? ORDER BY a.id DESC LIMIT 1',
      ['ask'],
    )
    expect(call.kind).toBe('ask')
  })

  it('多轮对话：历史一起发给模型，旧回答里的引用编号去掉', async () => {
    const c = new Client()
    await c.register('askmulti')
    const history = [
      { role: 'user', content: 'Redis 为什么快' },
      { role: 'assistant', content: '因为基于内存[1]，单线程没有锁竞争[2]。' },
    ]
    const res = await c.sse('/api/ask', { question: '那它有什么缺点？', history })
    expect(res.done.citations).toEqual([1, 2])
    const sent = await lastLlmRequest()
    expect(sent.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(sent.messages[2].content).toBe('因为基于内存，单线程没有锁竞争。')
  })

  it('一段资料都没找到时直接回复，不调用模型、不占次数', async () => {
    const c = new Client()
    const u = await c.register('asknohit')
    const res = await c.sse('/api/ask', { question: '？！' })
    expect(res.events[0]).toEqual({ event: 'sources', data: { sources: [] } })
    expect(res.text).toContain('手册里没有找到')
    expect(res.done).toEqual({ citations: [], remaining: inject('dailyLimit') })
    const [[count]] = await db().query<any[]>('SELECT COUNT(*) AS n FROM ai_calls WHERE user_id = ?', [u.id])
    expect(count.n).toBe(0)
  })
})
