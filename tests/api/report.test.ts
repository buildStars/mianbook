import { describe, expect, it } from 'vitest'
import { Client, db, questionId } from './helpers'

const tz = new Date().getTimezoneOffset()

describe('学习事件', () => {
  it('未登录不能记录', async () => {
    const res = await new Client().request('/api/events', { body: { events: [{ type: 'reveal', questionId: 1 }] } })
    expect(res.status).toBe(401)
  })

  it('批量记录，题目不存在或缺少时长的事件丢掉', async () => {
    const c = new Client()
    const user = await c.register('events')
    const qid = await questionId('01-event-loop', 'javascript')
    const { data } = await c.json('/api/events', {
      body: {
        events: [
          { type: 'read', questionId: qid, value: 120 },
          { type: 'read', questionId: 99999999, value: 60 },
          { type: 'read', questionId: qid },
          { type: 'reveal', questionId: qid },
          { type: 'voice', value: 30 },
        ],
      },
    })
    expect(data.saved).toBe(3)
    const [rows] = await db().query<any[]>('SELECT type, question_id, value FROM events WHERE user_id = ? ORDER BY id', [user.id])
    expect(rows).toEqual([
      { type: 'read', question_id: qid, value: 120 },
      { type: 'reveal', question_id: qid, value: null },
      { type: 'voice', question_id: null, value: 30 },
    ])
  })

  it.each([
    [{ type: 'click', questionId: 1 }],
    [{ type: 'read', questionId: 1, value: 3601 }],
    [{ type: 'read', questionId: 1, value: 0 }],
  ])('拒绝不合法的事件 %j', async (event) => {
    const c = new Client()
    await c.register('bad-event')
    expect((await c.request('/api/events', { body: { events: [event] } })).status).toBe(400)
  })
})

describe('学习周报', () => {
  it('汇总本周和上周，算出每天的时长、最卡的题和建议', async () => {
    const c = new Client()
    const user = await c.register('report')
    const a = await questionId('01-event-loop', 'javascript')
    const b = await questionId('02-closure', 'javascript')

    // 本周：读了两道题共 10 分钟，看了一次答案；上周读了 4 分钟
    await db().query(
      `INSERT INTO events (user_id, type, question_id, value, created_at) VALUES
        (?, 'read', ?, 360, NOW()), (?, 'read', ?, 240, NOW()), (?, 'reveal', ?, NULL, NOW()),
        (?, 'read', ?, 240, NOW() - INTERVAL 7 DAY)`,
      [user.id, a, user.id, b, user.id, a, user.id, a],
    )
    // 本周 AI 面试：a 第一轮 3 分，b 第一轮 8 分（会写入复习记录）
    await c.answer({ questionId: a, answer: '回答 [score=3]' })
    await c.answer({ questionId: b, answer: '回答 [score=8]' })
    // a 复习时又两次答"不会"
    await c.json(`/api/review/${a}`, { body: { grade: 1 } })
    await c.json(`/api/review/${a}`, { body: { grade: 1 } })

    const { status, data: r } = await c.json(`/api/report/weekly?tz=${tz}`)
    expect(status).toBe(200)
    expect(r.week.offset).toBe(0)
    expect(r.current).toMatchObject({
      studySeconds: 600,
      questionsRead: 2,
      interviews: 2,
      interviewAvg: 5.5,
      reveals: 1,
      reviews: 4, // 两次面试第一轮 + 两次复习评分
      newQuestions: 2,
    })
    expect(r.current.activeDays).toBeGreaterThanOrEqual(1)
    expect(r.previous.studySeconds).toBe(240)
    expect(r.daily).toHaveLength(7)
    expect(r.daily.reduce((s: number, d: any) => s + d.seconds, 0)).toBe(600)
    expect(r.trend).toHaveLength(8)
    expect(r.trend.at(-1).seconds).toBe(600)

    const js = r.categories.find((x: any) => x.title === 'JavaScript')
    expect(js).toMatchObject({ seconds: 600, interviews: 2, avgScore: 5.5, again: 3 })
    expect(r.stuck[0]).toMatchObject({ id: a, reason: 'AI 面试 3 分，3 次答"不会"' })
    expect(r.suggestions.some((s: any) => s.text.includes('JavaScript'))).toBe(true)
  })

  it('没有数据时给出起步建议；可以翻到上周', async () => {
    const c = new Client()
    await c.register('empty-report')
    const { data: r } = await c.json(`/api/report/weekly?tz=${tz}&offset=-1`)
    expect(r.week.offset).toBe(-1)
    expect(r.current.studySeconds).toBe(0)
    expect(r.suggestions[0].text).toContain('还没有学习记录')
    expect((await c.request(`/api/report/weekly?tz=${tz}&offset=1`)).status).toBe(400)
  })

  it('只能看自己的数据', async () => {
    const owner = new Client()
    const u = await owner.register('owner')
    await db().query("INSERT INTO events (user_id, type, question_id, value) VALUES (?, 'read', ?, 300)", [u.id, await questionId('01-event-loop', 'javascript')])
    const other = new Client()
    await other.register('other')
    expect((await other.json(`/api/report/weekly?tz=${tz}`)).data.current.studySeconds).toBe(0)
  })
})
