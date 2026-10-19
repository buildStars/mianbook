import { describe, expect, it } from 'vitest'
import { compactNumber, formatMoney, formatMs, formatSeconds, relativeTime } from '../../app/utils/admin-format'
import { aiKindLabel } from '../../shared/utils/ai-kinds'

describe('后台的数字和时间格式', () => {
  const now = new Date('2026-10-12T12:00:00Z').getTime()
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

  it('相对时间', () => {
    expect(relativeTime(ago(10), now)).toBe('刚刚')
    expect(relativeTime(ago(5 * 60), now)).toBe('5 分钟前')
    expect(relativeTime(ago(3 * 3600), now)).toBe('3 小时前')
    expect(relativeTime(ago(30 * 3600), now)).toBe('昨天')
    expect(relativeTime(ago(4 * 86400), now)).toBe('4 天前')
    expect(relativeTime('2026-03-01T12:00:00Z', now)).toBe('3 月 1 日')
    expect(relativeTime('2025-03-01T12:00:00Z', now)).toBe('2025 年 3 月 1 日')
  })

  it('大数字用"万"', () => {
    expect(compactNumber(8520)).toBe('8,520')
    expect(compactNumber(12_345)).toBe('1.2 万')
    expect(compactNumber(2_200_000)).toBe('220 万')
    expect(compactNumber(150_000_000)).toBe('1.5 亿')
  })

  it('时长', () => {
    expect(formatSeconds(0)).toBe('0 分钟')
    expect(formatSeconds(30)).toBe('不到 1 分钟')
    expect(formatSeconds(35 * 60)).toBe('35 分钟')
    expect(formatSeconds(150 * 60)).toBe('2.5 小时')
  })

  it('耗时和金额', () => {
    expect(formatMs(null)).toBe('—')
    expect(formatMs(850)).toBe('850ms')
    expect(formatMs(2345)).toBe('2.3s')
    expect(formatMoney({ amount: 12.3, currency: 'CNY' })).toBe('¥12.30')
    expect(formatMoney({ amount: 0, currency: 'USD' })).toBe('$0.00')
    // 单个用户的费用可能不到一分钱，不显示成 0
    expect(formatMoney({ amount: 0.0034, currency: 'CNY' })).toBe('不到 ¥0.01')
  })

  it('AI 功能名：自己的 Key 和站点 Key 显示同一个名字', () => {
    expect(aiKindLabel('interview')).toBe('AI 单题面试')
    expect(aiKindLabel('ask-own')).toBe('问手册')
    expect(aiKindLabel('unknown-kind')).toBe('unknown-kind')
  })
})
