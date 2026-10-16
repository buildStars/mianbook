import { describe, expect, inject, it } from 'vitest'
import { Client, db, lastLlmRequest } from './helpers'

async function start(c: Client, maxQuestions = 2) {
  const created = await c.json('/api/agent', { body: { goal: '下周面后端，Redis 是重点', maxQuestions } })
  expect(created.status).toBe(200)
  const id = created.data.id as number
  const first = await c.sse(`/api/agent/${id}/turn`, { action: 'start' })
  return { id, first }
}

const detail = async (c: Client, id: number) => (await c.json(`/api/agent/${id}`)).data
const answer = (c: Client, id: number, text: string) => c.sse(`/api/agent/${id}/turn`, { action: 'answer', answer: text })
const ended = (events: { event: string; data: any }[]) => events.filter((e) => e.event === 'tool_end').map((e) => e.data.item)

describe('Agent 面试', () => {
  it('完整流程：查记录、搜题、出题、看参考答案打分、写进复习计划、问满后总结', async () => {
    const c = new Client()
    const me = await c.register('agent')
    const { id, first } = await start(c, 2)

    // 第一轮：模型连续调用工具，最后出第一题停下
    expect(first.status).toBe(200)
    const toolStarts = first.events.filter((e) => e.event === 'tool_start').map((e) => e.data.tool)
    expect(toolStarts).toEqual(['get_learning_profile', 'search_questions', 'ask_question'])
    const items = ended(first.events)
    expect(items[0]).toMatchObject({ type: 'step', label: '查看了你的学习记录', error: null })
    expect(items[1].label).toMatch(/在题库里找题：「缓存穿透 击穿 雪崩」，找到 \d 道/)
    expect(items[2]).toMatchObject({ type: 'question', index: 1, followUp: null })
    expect(first.done).toEqual({ finished: false, truncated: false, remaining: inject('dailyLimit') - 1 })

    let d = await detail(c, id)
    expect(d.timeline.map((i: any) => i.type)).toEqual(['agent', 'step', 'step', 'question', 'agent'])
    expect(d.awaiting).toMatchObject({ questionId: items[2].questionId, followUp: null })
    const q1 = items[2].questionId as number

    // 第二轮：回答 → 查参考答案 → 打 3 分 → 出第二题
    const second = await answer(c, id, '[score=3] 我只知道要加缓存')
    const secondItems = ended(second.events)
    expect(secondItems.map((i: any) => i.type)).toEqual(['step', 'assessment', 'question'])
    expect(secondItems[0].label).toMatch(/^查看了「.+」的参考答案$/)
    expect(secondItems[1]).toMatchObject({ questionId: q1, score: 3, strengths: ['讲到了主要流程'], gaps: ['没讲清取舍'] })
    expect(secondItems[1].nextReview).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(secondItems[2]).toMatchObject({ type: 'question', index: 2 })
    expect(secondItems[2].questionId).not.toBe(q1)

    // 主问题的得分写进复习计划，低分标记为"不会"
    const [[log]] = await db().query<any[]>('SELECT rating, source FROM review_logs WHERE user_id = ? AND question_id = ?', [me.id, q1])
    expect(log).toEqual({ rating: 1, source: 'agent' })
    const [[record]] = await db().query<any[]>('SELECT status FROM study_records WHERE user_id = ? AND question_id = ?', [me.id, q1])
    expect(record.status).toBe('weak')

    // 第三轮：问满 2 道主问题，打分后写总结结束
    const third = await answer(c, id, '[score=9] 原理、取舍和实践都讲到了')
    expect(ended(third.events).map((i: any) => i.type)).toEqual(['step', 'assessment', 'finish'])
    expect(third.done.finished).toBe(true)
    expect(third.text).toContain('面试结束')

    // 发给模型的上下文：只保留最近一次的参考答案
    const sent = await lastLlmRequest()
    expect(sent.messages[0].content).toContain('自适应的模拟面试')
    expect(sent.tools.map((t: any) => t.function.name)).toContain('record_assessment')
    const refs = sent.messages.filter((m: any) => m.role === 'tool' && m.name === 'get_question_reference')
    expect(refs.length).toBe(2)
    expect(refs[0].content).toContain('已省略')
    expect(refs[1].content).toContain('"reference"')
    // 回答放在 <answer> 标签里
    expect(sent.messages.some((m: any) => m.role === 'user' && m.content.startsWith('<answer>\n[score=3]'))).toBe(true)

    d = await detail(c, id)
    expect(d).toMatchObject({ status: 'finished', asked: 2, score: 6, awaiting: null })
    expect(d.timeline.at(-2)).toMatchObject({ type: 'finish', summary: '整体基础不错，原理还要加强。' })
    expect((await answer(c, id, '还能继续吗')).status).toBe(400)

    // 一轮不管调了几次模型都只算一次
    const [[calls]] = await db().query<any[]>("SELECT COUNT(*) AS n FROM ai_calls WHERE user_id = ? AND kind = 'agent'", [me.id])
    expect(calls.n).toBe(3)
    expect((await c.json('/api/agent')).data[0]).toMatchObject({ id, status: 'finished', asked: 2, score: 6 })
  })

  it('追问的得分不进复习计划', async () => {
    const c = new Client()
    const me = await c.register('agentfollow')
    const { id } = await start(c, 3)
    const q1 = (await detail(c, id)).awaiting.questionId

    const r = await answer(c, id, '[score=5][followup] 方向对但不深入')
    expect(ended(r.events).at(-1)).toMatchObject({ type: 'question', questionId: q1, followUp: '如果数据量再大十倍，你会怎么改？', index: 1 })
    expect((await detail(c, id)).awaiting).toMatchObject({ questionId: q1, followUp: '如果数据量再大十倍，你会怎么改？' })

    const r2 = await answer(c, id, '[score=7] 分库分表加缓存')
    expect(ended(r2.events).map((i: any) => i.type)).toEqual(['step', 'assessment', 'question'])
    const [[logs]] = await db().query<any[]>('SELECT COUNT(*) AS n FROM review_logs WHERE user_id = ? AND question_id = ?', [me.id, q1])
    expect(logs.n).toBe(1)
  })

  it('模型给不是正在问的题打分时，工具返回错误，题目仍在等回答', async () => {
    const c = new Client()
    await c.register('agentguard')
    const { id } = await start(c)
    const before = (await detail(c, id)).awaiting
    const r = await answer(c, id, '[bad-assess] 随便答一下')
    const [step] = ended(r.events)
    expect(step).toMatchObject({ type: 'step', tool: 'record_assessment' })
    expect(step.error).toContain('只能给正在问的题打分')
    expect(r.text).toContain('工具出错了')
    expect((await detail(c, id)).awaiting).toEqual(before)
  })

  it('跳过一题、中途要求结束', async () => {
    const c = new Client()
    await c.register('agentskip')
    const { id } = await start(c, 3)
    const q1 = (await detail(c, id)).awaiting.questionId

    const skipped = await c.sse(`/api/agent/${id}/turn`, { action: 'skip' })
    expect(ended(skipped.events)).toEqual([expect.objectContaining({ type: 'question', index: 2 })])
    let d = await detail(c, id)
    expect(d.timeline.some((i: any) => i.type === 'action' && i.text === '你跳过了这道题')).toBe(true)
    expect(d.awaiting.questionId).not.toBe(q1)

    const finished = await c.sse(`/api/agent/${id}/turn`, { action: 'finish' })
    expect(ended(finished.events)).toEqual([expect.objectContaining({ type: 'finish', summary: '只答了一部分，基础还可以。' })])
    d = await detail(c, id)
    expect(d).toMatchObject({ status: 'finished', score: null })
    expect((await c.request(`/api/agent/${id}/turn`, { body: { action: 'skip' } })).status).toBe(400)
  })

  it('参数校验、重复开始、权限', async () => {
    expect((await new Client().request('/api/agent', { body: { goal: '面试后端' } })).status).toBe(401)
    const c = new Client()
    await c.register('agentval')
    expect((await c.request('/api/agent', { body: { goal: '短' } })).status).toBe(400)
    expect((await c.request('/api/agent', { body: { goal: '下周面试前端', maxQuestions: 20 } })).status).toBe(400)

    const { id } = await start(c)
    expect((await c.request(`/api/agent/${id}/turn`, { body: { action: 'start' } })).status).toBe(400)
    expect((await c.request(`/api/agent/${id}/turn`, { body: { action: 'answer' } })).status).toBe(400)

    const other = new Client()
    await other.register('agentother')
    expect((await other.request(`/api/agent/${id}`)).status).toBe(404)
    expect((await other.request(`/api/agent/${id}/turn`, { body: { action: 'finish' } })).status).toBe(404)
    expect((await other.request(`/api/agent/${id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await c.request(`/api/agent/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await c.request(`/api/agent/${id}`)).status).toBe(404)
  })
})
