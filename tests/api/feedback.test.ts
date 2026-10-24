import { beforeAll, describe, expect, it } from 'vitest'
import { Client, db, questionId } from './helpers'

async function admin() {
  const c = new Client()
  const u = await c.register('fbadmin')
  await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [u.id])
  return c
}

let qid: number
let a: Client
beforeAll(async () => {
  qid = await questionId('01-event-loop', 'javascript')
  a = await admin()
})

const submit = (c: Client, body: Record<string, unknown>) => c.json('/api/feedback', { body: { questionId: qid, kind: 'error', ...body } })

describe('题目纠错和反馈', () => {
  it('没登录也能提交，后台能看到；登录用户会记下是谁', async () => {
    const anon = new Client()
    expect((await submit(anon, { content: '匿名反馈：第二段的执行顺序写反了' })).status).toBe(200)

    const user = new Client()
    const u = await user.register('fbuser')
    expect((await submit(user, { kind: 'unclear', content: '登录反馈：requestAnimationFrame 的时机没讲清楚' })).status).toBe(200)

    const { status, data } = await a.json('/api/admin/feedback?status=open')
    expect(status).toBe(200)
    const anonRow = data.find((r: any) => r.content.startsWith('匿名反馈'))
    const userRow = data.find((r: any) => r.content.startsWith('登录反馈'))
    expect(anonRow).toMatchObject({ kind: 'error', status: 'open', user: null, question: { id: qid, path: '/basics/javascript/01-event-loop', published: true } })
    expect(userRow).toMatchObject({ kind: 'unclear', user: { id: u.id, email: u.email } })
  })

  it('校验内容、类型和题目', async () => {
    const c = new Client()
    expect((await submit(c, { content: '短' })).status).toBe(400)
    expect((await submit(c, { content: 'x'.repeat(1001) })).status).toBe(400)
    expect((await submit(c, { kind: 'spam', content: '类型不对的反馈内容' })).status).toBe(400)
    expect((await submit(c, { questionId: 99999999, content: '不存在的题目的反馈' })).status).toBe(404)
  })

  it('填了隐藏字段的机器人提交，假装成功但不保存', async () => {
    const c = new Client()
    expect((await submit(c, { content: '机器人提交的垃圾内容 bot-honeypot', website: 'http://spam.example' })).status).toBe(200)
    const [rows] = await db().query("SELECT COUNT(*) AS n FROM question_feedback WHERE content LIKE '%bot-honeypot%'")
    expect((rows as any)[0].n).toBe(0)
  })

  it('同一个 IP 每小时最多 10 条', async () => {
    const c = new Client()
    for (let i = 0; i < 10; i++) expect((await submit(c, { content: `限频测试第 ${i} 条反馈` })).status).toBe(200)
    expect((await submit(c, { content: '限频测试第 11 条反馈' })).status).toBe(429)
    // 换个 IP 不受影响
    expect((await submit(new Client(), { content: '另一个 IP 的反馈内容' })).status).toBe(200)
  })

  it('后台标记处理、忽略和重新打开；概览里提示待处理条数', async () => {
    const c = new Client()
    await submit(c, { kind: 'outdated', content: '处理流程测试：这个 API 已经改名了' })
    const { data: list } = await a.json('/api/admin/feedback?status=open')
    const row = list.find((r: any) => r.content.startsWith('处理流程测试'))

    const { data: dash } = await a.json('/api/admin/dashboard?tz=-480')
    expect(dash.alerts.some((x: any) => x.to === '/admin/feedback' && /有 \d+ 条读者反馈还没处理/.test(x.text))).toBe(true)

    expect((await a.json(`/api/admin/feedback/${row.id}`, { method: 'PUT', body: { status: 'resolved' } })).status).toBe(200)
    const { data: resolved } = await a.json('/api/admin/feedback?status=resolved')
    expect(resolved.find((r: any) => r.id === row.id)).toMatchObject({ status: 'resolved', handledAt: expect.any(String) })
    const { data: open } = await a.json('/api/admin/feedback?status=open')
    expect(open.some((r: any) => r.id === row.id)).toBe(false)

    expect((await a.json(`/api/admin/feedback/${row.id}`, { method: 'PUT', body: { status: 'open' } })).status).toBe(200)
    const { data: reopened } = await a.json('/api/admin/feedback?status=open')
    expect(reopened.find((r: any) => r.id === row.id)).toMatchObject({ status: 'open', handledAt: null })

    expect((await a.json('/api/admin/feedback/99999999', { method: 'PUT', body: { status: 'ignored' } })).status).toBe(404)
    expect((await a.json(`/api/admin/feedback/${row.id}`, { method: 'PUT', body: { status: 'done' } })).status).toBe(400)
  })

  it('普通用户和未登录用户看不到后台反馈', async () => {
    expect((await new Client().json('/api/admin/feedback')).status).toBe(401)
    const user = new Client()
    await user.register('fbplain')
    expect((await user.json('/api/admin/feedback')).status).toBe(403)
    expect((await user.json('/api/admin/feedback/1', { method: 'PUT', body: { status: 'resolved' } })).status).toBe(403)
  })
})
