import crypto from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { Client, db, questionId } from './helpers'

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36'
const vid = () => crypto.randomBytes(16).toString('hex')

/** 以浏览器的身份记一次访问 */
const pv = (c: Client, body: Record<string, unknown>, ua = BROWSER) =>
  c.request('/api/pv', { body: { device: 'desktop', ...body }, headers: { 'User-Agent': ua } })

const rowsOf = async (visitorId: string) => {
  const [rows] = await db().query('SELECT * FROM page_views WHERE visitor_id = ? ORDER BY id', [visitorId])
  return rows as any[]
}

let admin: Client
beforeAll(async () => {
  admin = new Client()
  const u = await admin.register('tradmin')
  await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [u.id])
})

describe('访问统计', () => {
  it('记下路径、外站来源（只在第一页）、utm 和设备；登录用户关联账号', async () => {
    const v = vid()
    const c = new Client()
    expect((await pv(c, { visitorId: v, path: '/?utm_source=V2EX', entry: true, referrer: 'https://www.v2ex.com/t/1', utmSource: 'V2EX' })).status).toBe(204)
    expect((await pv(c, { visitorId: v, path: '/basics/javascript/01-event-loop#q1', referrer: 'https://www.v2ex.com/t/1' })).status).toBe(204)
    const u = await c.register('trreader')
    expect((await pv(c, { visitorId: v, path: '/mock', device: 'mobile' })).status).toBe(204)

    const rows = await rowsOf(v)
    expect(rows.map((r) => [r.path, r.entry, r.referrer_host, r.utm_source, r.device, r.user_id])).toEqual([
      ['/', 1, 'www.v2ex.com', 'v2ex', 'desktop', null],
      ['/basics/javascript/01-event-loop', 0, null, null, 'desktop', null],
      ['/mock', 0, null, null, 'mobile', u.id],
    ])
  })

  it('爬虫、后台页面和管理员自己不记，但都返回 204', async () => {
    const v = vid()
    expect((await pv(new Client(), { visitorId: v, path: '/' }, 'Mozilla/5.0 (compatible; Googlebot/2.1)')).status).toBe(204)
    expect((await pv(new Client(), { visitorId: v, path: '/admin/users' })).status).toBe(204)
    expect((await pv(admin, { visitorId: v, path: '/' })).status).toBe(204)
    expect(await rowsOf(v)).toEqual([])
  })

  it('参数不对时 400', async () => {
    const c = new Client()
    expect((await pv(c, { visitorId: 'short', path: '/' })).status).toBe(400)
    expect((await pv(c, { visitorId: vid(), path: '/', device: 'tv' })).status).toBe(400)
  })

  it('站内来源不算外站', async () => {
    const v = vid()
    await pv(new Client(), { visitorId: v, path: '/ask', entry: true, referrer: 'https://mianbook.ink/' })
    expect((await rowsOf(v))[0]).toMatchObject({ entry: 1, referrer_host: null })
  })

  it('后台汇总：访客、浏览、来源、热门页面、漏斗和每天的数据', async () => {
    const v = vid()
    const c = new Client()
    const path = `/basics/javascript/01-event-loop`
    await pv(c, { visitorId: v, path: '/', entry: true, referrer: 'https://juejin.cn/post/1', utmSource: 'juejin' })
    await pv(c, { visitorId: v, path })
    // 30 小时前也来过：算回访访客。时间用 SQL 算（库里存 UTC，测试的连接没设时区，传 Date 会按本机时区写入）
    await db().query(
      "INSERT INTO page_views (visitor_id, path, entry, device, created_at) VALUES (?, ?, 0, 'desktop', UTC_TIMESTAMP() - INTERVAL 30 HOUR)",
      [v, path],
    )

    const { status, data } = await admin.json('/api/admin/traffic?days=7&tz=-480')
    expect(status).toBe(200)
    expect(data.days).toBe(7)
    expect(data.daily).toHaveLength(7)
    expect(data.daily.at(-1).visitors).toBeGreaterThanOrEqual(1)
    expect(data.totals.visitors).toBeGreaterThanOrEqual(1)
    expect(data.totals.views).toBeGreaterThanOrEqual(3)
    expect(data.totals.returning).toBeGreaterThanOrEqual(1)
    expect(data.funnel.map((f: any) => f.label)).toEqual(['访客', '看过题目', '注册', '做过 AI 面试'])
    expect(data.funnel[1].value).toBeGreaterThanOrEqual(1)
    expect(data.topPages.find((p: any) => p.path === path)).toMatchObject({ title: '说说浏览器的事件循环（Event Loop）' })
    expect(data.topPages.find((p: any) => p.path === '/')).toMatchObject({ title: '首页' })
    expect(data.referrers.some((r: any) => r.host === 'juejin.cn')).toBe(true)
    expect(data.utmSources.some((u: any) => u.source === 'juejin')).toBe(true)
    expect(data.devices.desktop).toBeGreaterThanOrEqual(1)

    // 新注册并做过一次 AI 面试的用户算激活
    const reader = new Client()
    await reader.register('tractive')
    const answered = await reader.answer({ questionId: await questionId('02-closure', 'javascript'), answer: '闭包是函数和它定义时的词法环境的组合' })
    expect(answered.status).toBe(200)
    const { data: after } = await admin.json('/api/admin/traffic?days=7&tz=-480')
    expect(after.totals.activated).toBeGreaterThanOrEqual(1)
    expect(after.funnel[3].value).toBe(after.totals.activated)

    expect((await admin.json('/api/admin/traffic?days=15')).status).toBe(400)
    const user = new Client()
    await user.register('trplain')
    expect((await user.json('/api/admin/traffic')).status).toBe(403)
  })
})
