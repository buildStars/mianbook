import { describe, expect, inject, it } from 'vitest'
import { Client, db, questionId } from './helpers'

const lastCall = async (userId: number) => {
  const [[row]] = await db().query<any[]>('SELECT * FROM ai_calls WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId])
  return row
}

describe('AI 调用可观测', () => {
  it('记录模型、提示词版本、首字延迟、总耗时和结果；出错的调用不扣次数', async () => {
    const c = new Client()
    const u = await c.register('obs')
    const qid = await questionId('02-closure', 'javascript')

    const failed = await c.answer({ questionId: qid, answer: '触发错误 [upstream-error]' })
    expect(failed.error?.message).toContain('AI 服务出错')
    const err = await lastCall(u.id)
    expect(err).toMatchObject({ kind: 'interview', status: 'error', model: 'mock-model', prompt_version: 'interview-v1', ttft_ms: null })
    expect(err.error).toContain('500')
    expect((await c.json('/api/ai/status')).data.remaining).toBe(inject('dailyLimit'))

    const ok = await c.answer({ questionId: qid, answer: '闭包就是函数记住了定义时的作用域 [score=7]' })
    expect(ok.done.score).toBe(7)
    const row = await lastCall(u.id)
    expect(row).toMatchObject({ kind: 'interview', status: 'ok', model: 'mock-model', prompt_version: 'interview-v1', error: null })
    expect(row.ttft_ms).toBeGreaterThanOrEqual(0)
    expect(row.latency_ms).toBeGreaterThanOrEqual(row.ttft_ms)
    expect((await c.json('/api/ai/status')).data.remaining).toBe(inject('dailyLimit') - 1)
  })

  it('后台看板：各功能的延迟分位数和出错率、最近的 AI 错误和服务端错误', async () => {
    const admin = new Client()
    const a = await admin.register('obsadmin')
    await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [a.id])
    await db().query("INSERT INTO error_logs (message, method, path, status_code) VALUES ('Connection lost', 'GET', '/api/test-error', 500)")

    const { data } = await admin.json('/api/admin/dashboard')
    const interview = data.perf.byKind.find((k: any) => k.kind === 'interview')
    expect(interview.calls).toBeGreaterThanOrEqual(2)
    expect(interview.errors).toBeGreaterThanOrEqual(1)
    expect(interview.errorRate).toBeGreaterThan(0)
    expect(interview.latencyP50).not.toBeNull()
    expect(data.perf.overall.kind).toBe('all')
    expect(data.perf.recentErrors[0]).toMatchObject({ kind: 'interview', model: 'mock-model' })
    expect(data.errors.count7d).toBeGreaterThanOrEqual(1)
    expect(data.errors.recent[0]).toMatchObject({ message: 'Connection lost', path: '/api/test-error', statusCode: 500 })
  })
})
