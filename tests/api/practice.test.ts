import { describe, expect, it } from 'vitest'
import { Client, baseUrl, db, lastLlmRequest } from './helpers'

const PATH = '/basics/handwriting/13-promisify'
const get = (path: string) => fetch(baseUrl() + path)

describe('默写练习', () => {
  it('列表按目录顺序，每道带标题和对应的题目', async () => {
    const list = await (await get('/api/practice')).json()
    const item = list.find((p: any) => p.path === PATH)
    expect(item).toMatchObject({ title: '手写 promisify', category: { slug: 'handwriting' } })
    expect(item.questionTitle).toContain('promisify')
    const nums = list.map((p: any) => p.num)
    expect(nums).toEqual([...nums].sort((a, b) => a - b))
  })

  it('详情有要求、提示、起始代码、测试和参考答案；没有练习的题 404', async () => {
    const res = await get(`/api/practice${PATH}`)
    expect(res.status).toBe(200)
    const p = await res.json()
    expect(p.taskHtml).toContain('<code>promisify(fn)</code>')
    expect(p.hints.length).toBeGreaterThanOrEqual(2)
    expect(p.hints.some((h: string) => h.includes('<code>'))).toBe(true)
    expect(p.starter).toContain('function promisify(fn)')
    expect(p.tests).toContain("test('")
    expect(p.solution).toContain('new Promise')
    expect(p.dom).toBe(false)
    expect((await get('/api/practice/basics/javascript/01-event-loop')).status).toBe(404)
  })

  it('题目详情和分类专题页标出有没有默写练习', async () => {
    expect((await (await get(`/api/questions${PATH}`)).json()).practice).toBe(true)
    expect((await (await get('/api/questions/basics/javascript/01-event-loop')).json()).practice).toBe(false)
    const cat = await (await get('/api/categories/basics/handwriting')).json()
    expect(cat.questions.find((q: any) => q.path === PATH).practice).toBe(true)
    const html = await (await get('/basics/handwriting')).text()
    expect(html).toContain('可以默写练习')
    expect(await (await get(PATH)).text()).toContain(`href="/practice${PATH}"`)
  })

  it('练习页和列表页服务端渲染，有自己的标题', async () => {
    const page = await get(`/practice${PATH}`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('<title>手写 promisify · 默写练习 | 面书</title>')
    expect(html).toContain('回调的 err 有值时 Promise 失败')
    expect(html).toContain('function promisify(fn)')
    const index = await (await get('/practice')).text()
    expect(index).toContain('<title>默写练习 | 面书</title>')
    expect(index).toContain(`href="/practice${PATH}"`)
    expect((await get('/practice/basics/javascript/01-event-loop')).status).toBe(404)
  })

  it('AI 点评要登录；点评时把要求、参考答案、测试结果和代码交给模型，记一次 practice 调用', async () => {
    const body = { path: PATH, code: 'function promisify(fn) { return fn }', passed: 2, total: 6, failures: [{ name: '保留调用时的 this', message: '期望 15，实际是 NaN' }] }
    expect((await new Client().request('/api/practice/review', { body })).status).toBe(401)

    const c = new Client()
    const user = await c.register('practice')
    const r = await c.sse('/api/practice/review', body)
    expect(r.error).toBeNull()
    expect(r.text.length).toBeGreaterThan(10)
    expect(r.done).toHaveProperty('remaining')

    const sent = await lastLlmRequest()
    const prompt = sent.messages.map((m: any) => m.content).join('\n')
    expect(prompt).toContain('手写 promisify')
    expect(prompt).toContain('通过 2 / 6 条')
    expect(prompt).toContain('没通过"保留调用时的 this"：期望 15，实际是 NaN')
    expect(prompt).toContain('function promisify(fn) { return fn }')
    expect(prompt).toContain('fn.call(this, ...args')

    const [[call]] = await db().query<any[]>('SELECT kind, prompt_version FROM ai_calls WHERE user_id = ? ORDER BY id DESC LIMIT 1', [user.id])
    expect(call).toMatchObject({ kind: 'practice', prompt_version: 'practice-v1' })

    expect((await c.request('/api/practice/review', { body: { ...body, path: '/basics/javascript/01-event-loop' } })).status).toBe(404)
    expect((await c.request('/api/practice/review', { body: { ...body, code: '  ' } })).status).toBe(400)
  })

  it('学习事件记下题目里运行代码和默写练习通过的次数', async () => {
    const c = new Client()
    const user = await c.register('practice-events')
    const [[q]] = await db().query<any[]>("SELECT id FROM questions WHERE slug = '13-promisify'")
    const { data } = await c.json('/api/events', {
      body: { events: [{ type: 'code_run', questionId: q.id }, { type: 'practice_pass', questionId: q.id }] },
    })
    expect(data.saved).toBe(2)
    const [rows] = await db().query<any[]>('SELECT type, question_id, value FROM events WHERE user_id = ? ORDER BY id', [user.id])
    expect(rows).toEqual([
      { type: 'code_run', question_id: q.id, value: null },
      { type: 'practice_pass', question_id: q.id, value: null },
    ])
  })
})
