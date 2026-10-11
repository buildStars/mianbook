import { describe, expect, it } from 'vitest'
import type { MockConfig, MockItem } from '../../shared/types/handbook'
import { itemScore, sessionScore, sessionTitle } from '../../server/utils/mock'

const item = (patch: Partial<MockItem>): MockItem => ({ questionId: 1, interviewId: null, scores: [], skipped: false, done: true, ...patch })

describe('模拟面试计分', () => {
  it('一道题的得分取各轮平均，保留一位小数', () => {
    expect(itemScore(item({ scores: [6, 8] }))).toBe(7)
    expect(itemScore(item({ scores: [6, 7, 7] }))).toBe(6.7)
  })

  it('跳过记 0 分，解析失败的轮次不计入', () => {
    expect(itemScore(item({ skipped: true }))).toBe(0)
    expect(itemScore(item({ scores: [null, 8] }))).toBe(8)
    expect(itemScore(item({ scores: [null] }))).toBeNull()
  })

  it('整场平均只算已经答完的题', () => {
    const items = [item({ scores: [6, 8] }), item({ skipped: true }), item({ scores: [9], done: false })]
    expect(sessionScore(items)).toBe(3.5)
    expect(sessionScore([item({ done: false, scores: [9] })])).toBeNull()
  })
})

describe('模拟面试标题', () => {
  const config: MockConfig = { track: 'go-backend', categoryIds: [], difficulty: 'advanced', count: 8, followUps: 1, preferWeak: true }

  it('按方向出题', () => {
    expect(sessionTitle(config)).toBe('Go 后端 · 进阶 · 8 题')
    expect(sessionTitle({ ...config, track: 'custom', difficulty: 'mixed' })).toBe('自选分类 · 混合 · 8 题')
  })

  it('按简历出题', () => {
    expect(sessionTitle({ ...config, mode: 'resume', role: '高级前端', count: 7 })).toBe('按简历出题 · 高级前端 · 7 题')
    expect(sessionTitle({ ...config, mode: 'resume', role: '  ', count: 4 })).toBe('按简历出题 · 项目深挖 · 4 题')
  })
})
