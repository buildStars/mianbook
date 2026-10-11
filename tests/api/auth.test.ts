import { describe, expect, it } from 'vitest'
import { Client, db } from './helpers'

describe('账号和权限', () => {
  it('第一个注册的账号是管理员，之后的都是普通用户', async () => {
    await new Client().register('a')
    await new Client().register('b')
    const [rows] = await db().query<any[]>('SELECT role FROM users ORDER BY id')
    expect(rows[0].role).toBe('admin')
    expect(rows.slice(1).every((r) => r.role === 'user')).toBe(true)
  })

  it('同一个邮箱不能重复注册', async () => {
    const c = new Client()
    const user = await c.register('dup')
    const { status } = await new Client().json('/api/auth/register', {
      body: { email: user.email, name: 'x', password: '12345678abc' },
    })
    expect(status).toBe(409)
  })

  it.each([
    ['GET', '/api/progress'],
    ['GET', '/api/review/summary'],
    ['GET', '/api/review/queue'],
    ['GET', '/api/mock'],
    ['POST', '/api/mock'],
    ['GET', '/api/progress/insights'],
    ['POST', '/api/interviews/stream'],
    ['POST', '/api/ai/check'],
  ])('未登录访问 %s %s 返回 401', async (method, path) => {
    const res = await new Client().request(path, { method, body: method === 'POST' ? {} : undefined })
    expect(res.status).toBe(401)
  })

  it('普通用户不能访问管理接口', async () => {
    const c = new Client()
    const me = await c.register('normal')
    expect(me.role).toBe('user')
    expect((await c.request('/api/admin/stats')).status).toBe(403)
  })

  it('只能看到自己的模拟面试', async () => {
    const alice = new Client()
    await alice.register('alice')
    const { data } = await alice.json('/api/mock', { body: { track: 'go-backend', difficulty: 'mixed', count: 5, followUps: 0, preferWeak: false } })
    const bob = new Client()
    await bob.register('bob')
    expect((await bob.request(`/api/mock/${data.id}`)).status).toBe(404)
    expect((await bob.request(`/api/mock/${data.id}`, { method: 'DELETE' })).status).toBe(404)
  })
})
