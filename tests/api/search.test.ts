import { describe, expect, it } from 'vitest'
import { baseUrl } from './helpers'

const search = async (q: string) => (await fetch(`${baseUrl()}/api/search?q=${encodeURIComponent(q)}`)).json() as Promise<any[]>

describe('站内搜索', () => {
  it('中文按双字词匹配："闭包"排第一的是讲闭包的题，不会单字误中"闭环""包住"', async () => {
    const hits = await search('闭包')
    expect(hits[0].title).toBe('什么是闭包？有哪些应用场景和坑？')
    for (const h of hits) expect(`${h.title}${h.snippet}`.replace(/<\/?mark>/g, '')).toContain('闭包')
    expect(hits[0].snippet).toContain('<mark>闭包</mark>')
  })

  it('"跨域"不再命中只含"跨"字的题', async () => {
    const hits = await search('跨域')
    expect(hits[0].title).toContain('跨域')
    expect(hits.some((h) => h.title.includes('ARP'))).toBe(false)
  })

  it('英文、中英混合和单字查询照常可用，空查询返回空', async () => {
    expect((await search('promise'))[0].title).toMatch(/Promise/)
    expect((await search('MySQL 索引'))[0].title).toContain('索引')
    expect((await search('锁')).length).toBeGreaterThan(0)
    expect(await search('  ')).toEqual([])
  })
})
