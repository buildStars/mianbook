import { describe, expect, it } from 'vitest'
import { Client, db, questionId } from './helpers'

const TZ = -480

describe('间隔复习', () => {
  it('标记掌握程度会加入复习计划，明天到期', async () => {
    const c = new Client()
    await c.register('rv')
    const qid = await questionId('01-event-loop', 'javascript')
    await c.json(`/api/progress/${qid}`, { method: 'PUT', body: { status: 'weak' } })
    const { data } = await c.json(`/api/review/summary?tz=${TZ}`)
    expect(data).toMatchObject({ total: 1, dueToday: 0, doneToday: 1 })
    expect(data.forecast).toHaveLength(7)
    expect(data.forecast[1].count).toBe(1)
  })

  it('10 分钟内改主意会撤回上一次评分，不重复计次', async () => {
    const c = new Client()
    const user = await c.register('undo')
    const qid = await questionId('02-closure', 'javascript')
    await c.json(`/api/progress/${qid}`, { method: 'PUT', body: { status: 'weak' } })
    await c.json(`/api/progress/${qid}`, { method: 'PUT', body: { status: 'mastered' } })
    const [[card]] = await db().query<any[]>('SELECT reps, scheduled_days FROM review_cards WHERE user_id = ?', [user.id])
    const [logs] = await db().query<any[]>('SELECT rating FROM review_logs WHERE user_id = ?', [user.id])
    expect(card).toMatchObject({ reps: 1, scheduled_days: 3 })
    expect(logs).toEqual([{ rating: 3 }])
  })

  it('只改收藏或笔记不影响复习计划', async () => {
    const c = new Client()
    const user = await c.register('star')
    const qid = await questionId('03-prototype-chain', 'javascript')
    await c.json(`/api/progress/${qid}`, { method: 'PUT', body: { starred: true, note: '原型链' } })
    const [[row]] = await db().query<any[]>('SELECT COUNT(*) n FROM review_cards WHERE user_id = ?', [user.id])
    expect(row.n).toBe(0)
  })

  it('到期的题出现在复习队列，评分后同步掌握程度', async () => {
    const c = new Client()
    const user = await c.register('queue')
    const qid = await questionId('01-event-loop', 'javascript')
    await c.json(`/api/progress/${qid}`, { method: 'PUT', body: { status: 'mastered' } })
    await db().query('UPDATE review_cards SET due = NOW() - INTERVAL 1 DAY WHERE user_id = ?', [user.id])

    const { data: queue } = await c.json(`/api/review/queue?tz=${TZ}`)
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ id: qid, status: 'mastered' })
    expect(queue[0].answerHtml).toContain('<p>')
    expect(queue[0].answerHtml).not.toContain('一句话回答')
    expect(queue[0].intervals[1]).toBeGreaterThanOrEqual(1)

    const { data } = await c.json(`/api/review/${qid}`, { body: { grade: 2 } })
    expect(data.record.status).toBe('fuzzy')
    expect((await c.json(`/api/review/queue?tz=${TZ}`)).data).toHaveLength(0)
    expect((await c.json(`/api/review/summary?tz=${TZ}`)).data.streak).toBe(1)
  })

  it('连续复习天数：今天还没复习时从昨天往前数', async () => {
    const c = new Client()
    const user = await c.register('streak')
    const qid = await questionId('01-event-loop', 'javascript')
    for (const d of [1, 2, 3]) {
      await db().query('INSERT INTO review_logs (user_id, question_id, rating, source, created_at) VALUES (?, ?, 3, "review", NOW() - INTERVAL ? DAY)', [user.id, qid, d])
    }
    expect((await c.json(`/api/review/summary?tz=${TZ}`)).data.streak).toBe(3)
  })

  it('评分参数不合法时拒绝', async () => {
    const c = new Client()
    await c.register('grade')
    const qid = await questionId('01-event-loop', 'javascript')
    expect((await c.request(`/api/review/${qid}`, { body: { grade: 5 } })).status).toBe(400)
    expect((await c.request('/api/review/999999', { body: { grade: 3 } })).status).toBe(404)
  })

  it('登录后合并本地记录时，有掌握程度的题加入复习计划', async () => {
    const c = new Client()
    const user = await c.register('import')
    const a = await questionId('01-event-loop', 'javascript')
    const b = await questionId('02-closure', 'javascript')
    const { data } = await c.json('/api/progress/import', {
      body: { records: { [a]: { status: 'fuzzy' }, [b]: { starred: true }, '/basics/javascript/03-prototype-chain': { status: 'weak' } } },
    })
    expect(data).toEqual({ imported: 3, skipped: 0 })
    const [[row]] = await db().query<any[]>('SELECT COUNT(*) n FROM review_cards WHERE user_id = ?', [user.id])
    expect(row.n).toBe(2)
  })
})
