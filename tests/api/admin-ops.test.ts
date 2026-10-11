import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, inject, it } from 'vitest'
import { Client, db } from './helpers'

const file = (...p: string[]) => path.join(inject('contentDir'), ...p)

async function admin() {
  const c = new Client()
  const u = await c.register('admin')
  await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [u.id])
  return c
}

async function categoryId(part: string, slug: string) {
  const [[row]] = await db().query<any[]>(
    'SELECT c.id FROM categories c JOIN parts p ON p.id = c.part_id WHERE p.slug = ? AND c.slug = ?',
    [part, slug],
  )
  return row.id as number
}

const CONTENT = '::: tip 一句话回答\n测试内容。\n:::\n\n## 详细解析\n\n第一段。\n\n第二段。\n'
const question = (patch: Record<string, unknown>) => ({
  slug: '97-ops-test',
  title: '运营功能测试题？',
  difficulty: 2,
  tags: ['实践'],
  contentMd: CONTENT,
  status: 'draft',
  ...patch,
})

describe('AI 设置在线修改', () => {
  let c: Client
  let defaults: { model: string; dailyLimit: number; extraHosts: string[] }

  afterAll(async () => {
    // 恢复成 .env 的默认值，不影响其他测试
    await c.json('/api/admin/settings/ai', {
      method: 'PUT',
      body: { ...defaults, allowUserKey: true, pricing: null },
    })
  })

  it('读取当前设置，只告诉前端 Key 有没有配置', async () => {
    c = await admin()
    const { status, data } = await c.json('/api/admin/settings')
    expect(status).toBe(200)
    expect(data.ai).toMatchObject({ model: 'mock-model', keyConfigured: true, allowUserKey: true, pricing: null, overridden: {} })
    expect(JSON.stringify(data)).not.toMatch(/apiKey/i)
    expect(data.contentSync).toBe(true)
    defaults = data.ai.defaults
  })

  it('保存后立即生效，只存和 .env 不一样的项', async () => {
    const saved = await c.json('/api/admin/settings/ai', {
      method: 'PUT',
      body: {
        model: 'mock-model-2',
        dailyLimit: defaults.dailyLimit,
        extraHosts: ['API.Example.com', 'api.example.com'],
        allowUserKey: false,
        pricing: { input: 2, output: 8, currency: 'CNY' },
      },
    })
    expect(saved.status).toBe(200)
    expect(saved.data.overridden).toEqual({
      model: 'mock-model-2',
      extraHosts: ['api.example.com'],
      allowUserKey: false,
      pricing: { input: 2, output: 8, currency: 'CNY' },
    })

    const status = await new Client().json('/api/ai/status')
    expect(status.data).toMatchObject({ model: 'mock-model-2', allowUserKey: false, extraHosts: ['api.example.com'] })
  })

  it('校验输入，普通用户不能改', async () => {
    const bad = await c.json('/api/admin/settings/ai', {
      method: 'PUT',
      body: { model: 'bad model!', dailyLimit: -1, extraHosts: ['not a host'], allowUserKey: true, pricing: null },
    })
    expect(bad.status).toBe(400)

    const user = new Client()
    await user.register('nobody')
    expect((await user.request('/api/admin/settings')).status).toBe(403)
    expect((await user.request('/api/admin/settings/ai', { method: 'PUT', body: {} })).status).toBe(403)
  })

  it('运营看板：AI 用量、费用估算、活跃和难度榜', async () => {
    const user = new Client()
    const u = await user.register('dash')
    const q = await db().query<any[]>(
      "SELECT q.id FROM questions q JOIN categories c ON c.id = q.category_id WHERE c.slug = 'design-pattern' ORDER BY q.sort LIMIT 1",
    )
    const qid = q[0][0].id
    // 两次面试第一轮 0 分和 1 分，一次没解析出分数的不计入
    const turns = (score: number | null) => JSON.stringify([{ answer: 'a', feedback: 'f', score, followUp: null, at: new Date().toISOString() }])
    await db().query('INSERT INTO interviews (user_id, question_id, turns, rounds, score) VALUES (?, ?, ?, 1, 0), (?, ?, ?, 1, 1), (?, ?, ?, 1, NULL)', [
      u.id, qid, turns(0), u.id, qid, turns(1), u.id, qid, turns(null),
    ])
    await db().query("INSERT INTO ai_calls (user_id, kind, prompt_tokens, completion_tokens) VALUES (?, 'interview', 1000000, 500000), (?, 'resume-own', NULL, NULL)", [u.id, u.id])
    await db().query("INSERT INTO events (user_id, type, question_id, value) VALUES (?, 'read', ?, 120)", [u.id, qid])
    await db().query('INSERT INTO review_logs (user_id, question_id, rating, source) VALUES (?, ?, 1, ?)', [u.id, qid, 'review'])

    const { status, data } = await c.json('/api/admin/dashboard?tz=-480')
    expect(status).toBe(200)
    expect(data.days).toHaveLength(14)
    expect(data.ai.daily).toHaveLength(14)
    const today = data.ai.daily.at(-1)
    expect(today.site).toBeGreaterThanOrEqual(1)
    expect(today.own).toBeGreaterThanOrEqual(1)
    expect(data.ai.promptTokens).toBeGreaterThanOrEqual(1_000_000)
    // 价格是 2 / 8 元每百万 token
    expect(data.ai.cost).toEqual({
      amount: Math.round(((data.ai.promptTokens * 2 + data.ai.completionTokens * 8) / 1e6) * 100) / 100,
      currency: 'CNY',
    })
    expect(data.ai.byKind.find((k: any) => k.kind === 'resume').own).toBeGreaterThanOrEqual(1)
    expect(data.activity.dau).toBeGreaterThanOrEqual(1)
    expect(data.activity.users).toBeGreaterThanOrEqual(2)

    const low = data.board.lowScore.find((x: any) => x.id === qid)
    expect(low).toMatchObject({ avg: 0.5, count: 2, status: 'published' })
    expect(low.path).toMatch(/^\/basics\/design-pattern\//)
    expect(data.board.forgotten.some((x: any) => x.id === qid)).toBe(true)
    expect(data.board.popular.find((x: any) => x.id === qid)).toMatchObject({ users: 1, seconds: 120 })
    expect(data.content.recent.length).toBeGreaterThan(0)

    expect((await c.request('/api/admin/dashboard?tz=9999')).status).toBe(400)
    expect((await user.request('/api/admin/dashboard')).status).toBe(403)
  })
})

describe('题目的修改历史', () => {
  it('每次保存记一个版本，没改动不记；外部修改会在下次保存前补记', async () => {
    const c = await admin()
    const js = await categoryId('basics', 'javascript')
    const created = await c.json('/api/admin/questions', { body: question({ categoryId: js, slug: '96-history-test' }) })
    const id = created.data.id

    await c.json(`/api/admin/questions/${id}`, { method: 'PUT', body: question({ categoryId: js, slug: '96-history-test', contentMd: `${CONTENT}\n第三段。\n`, difficulty: 3 }) })
    // 内容没变，不新增版本
    await c.json(`/api/admin/questions/${id}`, { method: 'PUT', body: question({ categoryId: js, slug: '96-history-test', contentMd: `${CONTENT}\n第三段。\n`, difficulty: 3 }) })

    let list = await c.json(`/api/admin/questions/${id}/versions`)
    expect(list.status).toBe(200)
    expect(list.data).toHaveLength(2)
    expect(list.data[0]).toMatchObject({ current: true, difficulty: 3, added: 2, removed: 0, editor: 'admin' })
    expect(list.data[1]).toMatchObject({ current: false, difficulty: 2, added: null, removed: null })

    const oldest = await c.json(`/api/admin/questions/${id}/versions/${list.data[1].id}`)
    expect(oldest.data.contentMd).toBe(CONTENT)

    // 模拟命令行导入改了数据库：下次保存时先把它补存为一个版本（editor 为空）
    await db().query("UPDATE questions SET content_md = '外部改的内容', updated_at = NOW() WHERE id = ?", [id])
    await c.json(`/api/admin/questions/${id}`, { method: 'PUT', body: question({ categoryId: js, slug: '96-history-test', title: '新标题？' }) })
    list = await c.json(`/api/admin/questions/${id}/versions`)
    expect(list.data).toHaveLength(4)
    expect(list.data[0]).toMatchObject({ title: '新标题？', current: true })
    expect(list.data[1]).toMatchObject({ editor: null, current: false })
    const external = await c.json(`/api/admin/questions/${id}/versions/${list.data[1].id}`)
    expect(external.data.contentMd).toBe('外部改的内容')

    // 版本必须属于这道题
    expect((await c.request(`/api/admin/questions/${id + 100000}/versions/${list.data[0].id}`)).status).toBe(404)

    await c.request(`/api/admin/questions/${id}`, { method: 'DELETE' })
    const [[left]] = await db().query<any[]>('SELECT COUNT(*) n FROM question_versions WHERE question_id = ?', [id])
    expect(left.n).toBe(0)
  })
})

describe('批量操作', () => {
  it('发布、转草稿、移动分类、删除，并同步文件', async () => {
    const c = await admin()
    const js = await categoryId('basics', 'javascript')
    const ts = await categoryId('basics', 'typescript')
    const a = (await c.json('/api/admin/questions', { body: question({ categoryId: js }) })).data.id
    // 另一道题放在 TypeScript，slug 和 a 一样，a 搬过去时会冲突
    const b = (await c.json('/api/admin/questions', { body: question({ categoryId: ts, title: '同名题？' }) })).data.id
    expect(fs.readFileSync(file('basics', 'javascript', '97-ops-test.md'), 'utf8')).toContain('status: draft')

    const published = await c.json('/api/admin/questions/batch', { body: { action: 'publish', ids: [a, b, a] } })
    expect(published.data).toMatchObject({ changed: 2, skipped: 0, failed: [], sync: { synced: true } })
    expect(fs.readFileSync(file('basics', 'javascript', '97-ops-test.md'), 'utf8')).not.toContain('status: draft')
    const again = await c.json('/api/admin/questions/batch', { body: { action: 'publish', ids: [a] } })
    expect(again.data).toMatchObject({ changed: 0, skipped: 1 })
    // 改状态也记进修改历史
    const versions = await c.json(`/api/admin/questions/${a}/versions`)
    expect(versions.data[0]).toMatchObject({ status: 'published', added: 0, removed: 0 })

    const conflict = await c.json('/api/admin/questions/batch', { body: { action: 'move', ids: [a], categoryId: ts } })
    expect(conflict.data.changed).toBe(0)
    expect(conflict.data.failed[0]).toMatchObject({ id: a })

    await c.json('/api/admin/questions/batch', { body: { action: 'delete', ids: [b] } })
    expect(fs.existsSync(file('basics', 'typescript', '97-ops-test.md'))).toBe(false)

    const moved = await c.json('/api/admin/questions/batch', { body: { action: 'move', ids: [a], categoryId: ts } })
    expect(moved.data).toMatchObject({ changed: 1, sync: { synced: true } })
    expect(fs.existsSync(file('basics', 'javascript', '97-ops-test.md'))).toBe(false)
    expect(fs.readFileSync(file('basics', 'typescript', '97-ops-test.md'), 'utf8')).toContain('# 运营功能测试题？')
    // 排在目标分类最后
    const [[pos]] = await db().query<any[]>('SELECT sort, (SELECT MAX(sort) FROM questions WHERE category_id = ?) top FROM questions WHERE id = ?', [ts, a])
    expect(pos.sort).toBe(pos.top)

    const draft = await c.json('/api/admin/questions/batch', { body: { action: 'draft', ids: [a] } })
    expect(draft.data.changed).toBe(1)
    expect(fs.readFileSync(file('basics', 'typescript', '97-ops-test.md'), 'utf8')).toContain('status: draft')

    const removed = await c.json('/api/admin/questions/batch', { body: { action: 'delete', ids: [a] } })
    expect(removed.data.changed).toBe(1)
    expect(fs.existsSync(file('basics', 'typescript', '97-ops-test.md'))).toBe(false)
  })

  it('校验参数，普通用户不能用', async () => {
    const c = await admin()
    expect((await c.request('/api/admin/questions/batch', { body: { action: 'publish', ids: [] } })).status).toBe(400)
    expect((await c.request('/api/admin/questions/batch', { body: { action: 'move', ids: [1] } })).status).toBe(400)
    expect((await c.request('/api/admin/questions/batch', { body: { action: 'drop', ids: [1] } })).status).toBe(400)
    expect((await c.request('/api/admin/questions/batch', { body: { action: 'move', ids: [1], categoryId: 999999 } })).status).toBe(400)

    const user = new Client()
    await user.register('nobody')
    expect((await user.request('/api/admin/questions/batch', { body: { action: 'publish', ids: [1] } })).status).toBe(403)
  })
})
