import { createEmptyCard, fsrs } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { endOfLocalDay, gradeFromScore, gradeFromStatus, localDate, previewIntervals, statusFromGrade } from '../../server/utils/review'

describe('评分换算', () => {
  it.each([
    [0, 1],
    [4, 1],
    [5, 2],
    [7, 2],
    [8, 3],
    [9, 3],
    [10, 4],
  ])('AI 得分 %s → 复习评分 %s', (score, grade) => {
    expect(gradeFromScore(score)).toBe(grade)
  })

  it('掌握程度和复习评分互相对应', () => {
    expect(gradeFromStatus).toEqual({ weak: 1, fuzzy: 2, mastered: 3 })
    expect([1, 2, 3, 4].map((g) => statusFromGrade(g as 1 | 2 | 3 | 4))).toEqual(['weak', 'fuzzy', 'mastered', 'mastered'])
  })
})

describe('按用户时区计算"今天"', () => {
  const now = new Date('2026-10-11T10:00:00Z')

  it('东八区：当地 18 点，今天结束于 UTC 16 点', () => {
    expect(endOfLocalDay(-480, now).toISOString()).toBe('2026-10-11T16:00:00.000Z')
  })

  it('UTC 和西五区', () => {
    expect(endOfLocalDay(0, now).toISOString()).toBe('2026-10-12T00:00:00.000Z')
    expect(endOfLocalDay(300, now).toISOString()).toBe('2026-10-12T05:00:00.000Z')
  })

  it('UTC 时间还是 11 号，东八区已经是 12 号凌晨', () => {
    const late = new Date('2026-10-11T17:00:00Z')
    expect(endOfLocalDay(-480, late).toISOString()).toBe('2026-10-12T16:00:00.000Z')
    expect(localDate(late, -480)).toBe('2026-10-12')
    expect(localDate(late, 0)).toBe('2026-10-11')
  })

  it('往后数几天', () => {
    expect(endOfLocalDay(-480, now, 6).toISOString()).toBe('2026-10-17T16:00:00.000Z')
  })
})

describe('复习间隔', () => {
  it('新题：不会明天、模糊 2 天、会了 3 天、很熟 8 天', () => {
    const now = new Date('2026-10-11T10:00:00Z')
    expect(previewIntervals(createEmptyCard(now), now)).toEqual({ 1: 1, 2: 2, 3: 3, 4: 8 })
  })

  // 上限设的是 120 天；ts-fsrs 为了让四档评分的间隔依次拉开，"会了""很熟"会比上限多一两天
  it('一直答"很熟"，间隔也不超过 4 个月', () => {
    // 和 server/utils/review.ts 里的调度器参数一致
    const scheduler = fsrs({ enable_short_term: false, maximum_interval: 120 })
    let now = new Date('2026-01-01T00:00:00Z')
    let card = createEmptyCard(now)
    for (let i = 0; i < 12; i++) {
      card = scheduler.next(card, now, 4).card
      now = card.due
    }
    expect(card.scheduled_days).toBeLessThanOrEqual(122)
    expect(previewIntervals(card, now)[4]).toBeLessThanOrEqual(122)
  })

  it('评分越高，下次间隔越长', () => {
    const now = new Date('2026-10-11T10:00:00Z')
    const scheduler = fsrs({ enable_short_term: false, maximum_interval: 120 })
    const card = scheduler.next(createEmptyCard(now), now, 3).card
    const later = card.due
    const p = previewIntervals(card, later)
    expect(p[1]).toBeLessThanOrEqual(p[2])
    expect(p[2]).toBeLessThanOrEqual(p[3])
    expect(p[3]).toBeLessThanOrEqual(p[4])
    expect(p[1]).toBeGreaterThanOrEqual(1)
  })
})
