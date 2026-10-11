import { describe, expect, it } from 'vitest'
import { weekRange } from '../../server/utils/report'

describe('weekRange：按用户时区算一周（周一开始）', () => {
  it('东八区周六：本周从周一 0 点（UTC 前一天 16 点）开始', () => {
    // 2026-10-17 是周六；东八区当地 18 点
    const w = weekRange(-480, new Date('2026-10-17T10:00:00Z'))
    expect(w.start.toISOString()).toBe('2026-10-11T16:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-10-18T16:00:00.000Z')
    expect(w.days).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
  })

  it('周日算在本周最后一天，不是下周第一天', () => {
    const w = weekRange(-480, new Date('2026-10-18T15:59:00Z')) // 当地周日 23:59
    expect(w.days[0]).toBe('2026-10-12')
  })

  it('UTC 还是周日，东八区已经是下周一', () => {
    const w = weekRange(-480, new Date('2026-10-18T16:30:00Z')) // 当地周一 00:30
    expect(w.days[0]).toBe('2026-10-19')
  })

  it('往前翻周', () => {
    const now = new Date('2026-10-17T10:00:00Z')
    expect(weekRange(-480, now, -1).days[0]).toBe('2026-10-05')
    expect(weekRange(0, now, -2).days[0]).toBe('2026-09-28')
  })

  it('西五区', () => {
    const w = weekRange(300, new Date('2026-10-12T03:00:00Z')) // 当地周日 22 点
    expect(w.days[0]).toBe('2026-10-05')
    expect(w.start.toISOString()).toBe('2026-10-05T05:00:00.000Z')
  })
})
