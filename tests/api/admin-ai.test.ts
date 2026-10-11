import { describe, expect, it } from 'vitest'
import { Client, db, lastLlmRequest, questionId } from './helpers'

async function admin() {
  const c = new Client()
  const u = await c.register('admin')
  await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [u.id])
  return { c, id: u.id }
}

async function categoryId(part: string, slug: string) {
  const [[row]] = await db().query<any[]>(
    'SELECT c.id FROM categories c JOIN parts p ON p.id = c.part_id WHERE p.slug = ? AND c.slug = ?',
    [part, slug],
  )
  return row.id as number
}

const authorCalls = async (userId: number) => {
  const [[row]] = await db().query<any[]>("SELECT COUNT(*) n FROM ai_calls WHERE user_id = ? AND kind = 'author'", [userId])
  return row.n as number
}

describe('后台 AI 写题', () => {
  it('起草：提示词带写作规范、同分类题目和参考题，流式返回正文，不占每日次数', async () => {
    const { c, id } = await admin()
    const js = await categoryId('basics', 'javascript')
    const before = (await c.json('/api/ai/status')).data.remaining

    const res = await c.sse('/api/admin/ai/draft', { categoryId: js, title: '`Promise.all` 和 `Promise.allSettled` 的区别？', difficulty: 2, notes: '讲清失败时的行为' })
    expect(res.status).toBe(200)
    expect(res.error).toBeNull()
    expect(res.done).toMatchObject({ length: expect.any(Number) })
    expect(res.text).toContain('::: tip 一句话回答')

    const sent = await lastLlmRequest()
    expect(sent.max_tokens).toBe(8192)
    // 写作规范来自 templates/writing-guide.md，打包进了服务端
    expect(sent.messages[0].content).toContain('只链接已经存在的题目')
    expect(sent.messages[1].content).toContain('/basics/javascript/01-event-loop')
    expect(sent.messages[1].content).toContain('<example>')
    expect(sent.messages[1].content).toContain('<notes>\n讲清失败时的行为\n</notes>')

    expect(await authorCalls(id)).toBe(1)
    expect((await c.json('/api/ai/status')).data.remaining).toBe(before)
  })

  it('改写：修复格式问题、按要求修改，把当前正文发给模型', async () => {
    const { c } = await admin()
    const js = await categoryId('basics', 'javascript')
    const common = { categoryId: js, title: '测试题？', difficulty: 2, contentMd: '::: tip 一句话回答\n原文内容\n:::\n' }

    const lint = await c.sse('/api/admin/ai/revise', { ...common, mode: 'lint', issues: ['第 2 行：出现"首先"'] })
    expect(lint.error).toBeNull()
    expect(lint.text).toContain('## 易错点')
    let sent = await lastLlmRequest()
    expect(sent.messages[1].content).toContain('<issues>\n- 第 2 行：出现"首先"\n</issues>')
    expect(sent.messages[1].content).toContain('<content>\n::: tip 一句话回答\n原文内容\n:::\n</content>')

    const custom = await c.sse('/api/admin/ai/revise', { ...common, mode: 'custom', instruction: '代码改成 TypeScript' })
    expect(custom.error).toBeNull()
    sent = await lastLlmRequest()
    expect(sent.messages[1].content).toContain('<instruction>\n代码改成 TypeScript\n</instruction>')

    // 没有问题可修、没写要求时直接拒绝，不调用模型
    expect((await c.request('/api/admin/ai/revise', { body: { ...common, mode: 'lint', issues: [] } })).status).toBe(400)
    expect((await c.request('/api/admin/ai/revise', { body: { ...common, mode: 'custom', instruction: '' } })).status).toBe(400)
  })

  it('参考面试反馈：只发送 AI 点评里的遗漏，不发送用户的回答', async () => {
    const { c, id } = await admin()
    const cat = await categoryId('basics', 'design-pattern')
    const [[q]] = await db().query<any[]>('SELECT id, title FROM questions WHERE category_id = ? ORDER BY sort DESC LIMIT 1', [cat])
    const common = { categoryId: cat, title: q.title, difficulty: 2, contentMd: '::: tip 一句话回答\n原文\n:::\n', questionId: q.id }

    const none = await c.json('/api/admin/ai/revise', { body: { ...common, mode: 'feedback' } })
    expect(none.status).toBe(400)
    expect(none.data.message).toContain('还没有 AI 面试记录')

    const turns = JSON.stringify([
      {
        answer: '这是用户的原始回答，不应该发给模型',
        feedback: '得分：3/10\n### 答对的点\n- 无\n### 遗漏或不准确\n- 没讲清适用场景\n### 改进建议\n先讲结论。\n### 追问\n无',
        score: 3,
        followUp: null,
        at: new Date().toISOString(),
      },
    ])
    await db().query('INSERT INTO interviews (user_id, question_id, turns, rounds, score) VALUES (?, ?, ?, 1, 3)', [id, q.id, turns])

    const res = await c.sse('/api/admin/ai/revise', { ...common, mode: 'feedback' })
    expect(res.error).toBeNull()
    const sent = await lastLlmRequest()
    expect(sent.messages[1].content).toContain('共 1 次面试，第一轮平均 3.0 分')
    expect(sent.messages[1].content).toContain('- 没讲清适用场景')
    expect(sent.messages[1].content).not.toContain('用户的原始回答')
  })

  it('选题建议：解析模型输出，去掉和已有题目重复的', async () => {
    const { c } = await admin()
    const js = await categoryId('basics', 'javascript')
    const { status, data } = await c.json('/api/admin/ai/topics', { body: { categoryId: js, hint: '异步' } })
    expect(status).toBe(200)
    expect(data.suggestions).toEqual([
      { difficulty: 2, title: '`Promise.all` 和 `Promise.allSettled` 有什么区别？', reason: '高频的对比题' },
      { difficulty: 3, title: '如何设计一个前端监控 SDK？', reason: '综合考察工程能力' },
    ])
    const sent = await lastLlmRequest()
    expect(sent.messages[1].content).toContain('说说浏览器的事件循环（Event Loop）')
  })

  it('校验参数，普通用户不能用', async () => {
    const { c } = await admin()
    const js = await categoryId('basics', 'javascript')
    expect((await c.request('/api/admin/ai/draft', { body: { categoryId: js, title: '', difficulty: 2 } })).status).toBe(400)
    expect((await c.request('/api/admin/ai/draft', { body: { categoryId: 999999, title: '不存在的分类？', difficulty: 2 } })).status).toBe(400)

    const user = new Client()
    await user.register('nobody')
    const qid = await questionId('01-event-loop', 'javascript')
    expect((await user.request('/api/admin/ai/draft', { body: { categoryId: js, title: '越权？', difficulty: 2 } })).status).toBe(403)
    expect((await user.request('/api/admin/ai/topics', { body: { categoryId: js } })).status).toBe(403)
    expect(
      (await user.request('/api/admin/ai/revise', { body: { categoryId: js, title: '越权？', difficulty: 2, contentMd: 'x', mode: 'feedback', questionId: qid } })).status,
    ).toBe(403)
  })
})
