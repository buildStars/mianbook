import { describe, expect, it } from 'vitest'
import { diffHunks, diffLines, diffStats, withInlineChanges } from '#shared/utils/line-diff'

describe('diffLines 按行对比', () => {
  it('内容一样时全部是相同行', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc')
    expect(lines.every((l) => l.type === 'same')).toBe(true)
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0 })
  })

  it('标出新增和删除的行，并带上新旧行号', () => {
    const lines = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne')
    expect(lines).toEqual([
      { type: 'same', text: 'a', oldNo: 1, newNo: 1 },
      { type: 'del', text: 'b', oldNo: 2 },
      { type: 'add', text: 'B', newNo: 2 },
      { type: 'same', text: 'c', oldNo: 3, newNo: 3 },
      { type: 'same', text: 'd', oldNo: 4, newNo: 4 },
      { type: 'add', text: 'e', newNo: 5 },
    ])
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 })
  })

  it('中间插入一段时，后面的行号正确错开', () => {
    const lines = diffLines('x\ny', 'x\n1\n2\ny')
    expect(lines.at(-1)).toEqual({ type: 'same', text: 'y', oldNo: 2, newNo: 4 })
  })

  it('从空文本开始全部是新增', () => {
    expect(diffStats(diffLines('', 'a\nb'))).toEqual({ added: 2, removed: 1 })
  })

  it('差异太大时整段当作删除再新增，不会卡住', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n')
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n')
    const start = Date.now()
    expect(diffStats(diffLines(a, b))).toEqual({ added: 3000, removed: 3000 })
    expect(Date.now() - start).toBeLessThan(1000)
  })
})

describe('diffHunks 折叠没改动的行', () => {
  it('只保留改动前后几行，记录省略了多少行', () => {
    const old = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
    const next = [...old]
    next[9] = 'changed'
    const hunks = diffHunks(diffLines(old.join('\n'), next.join('\n')), 2)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.skipped).toBe(7)
    expect(hunks[0]!.lines.map((l) => l.text)).toEqual(['line 8', 'line 9', 'line 10', 'changed', 'line 11', 'line 12'])
  })

  it('两处改动离得远时分成两块', () => {
    const old = Array.from({ length: 30 }, (_, i) => `${i}`)
    const next = [...old]
    next[2] = 'x'
    next[25] = 'y'
    const hunks = diffHunks(diffLines(old.join('\n'), next.join('\n')), 1)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]!.skipped).toBe(1)
    // 第一块到第 4 行（'3'）为止，第二块从 '24' 开始，中间 '4'～'23' 共 20 行折叠
    expect(hunks[1]!.skipped).toBe(20)
    expect(hunks[1]!.lines[0]!.text).toBe('24')
  })
})

describe('withInlineChanges 行内改动', () => {
  it('配对的删除和新增行标出改动的字', () => {
    const lines = withInlineChanges(diffLines('闭包是函数和词法环境的组合。\n下一行', '闭包是函数和它定义时所在词法环境的组合。\n下一行'))
    // 纯插入：旧行里没有改动的部分，只剩前后两段
    expect(lines[0]!.segments).toEqual([
      { text: '闭包是函数和', changed: false },
      { text: '词法环境的组合。', changed: false },
    ])
    expect(lines[1]!.segments).toEqual([
      { text: '闭包是函数和', changed: false },
      { text: '它定义时所在', changed: true },
      { text: '词法环境的组合。', changed: false },
    ])
    expect(lines[2]!.segments).toBeUndefined()
  })

  it('整行都不一样时不标', () => {
    const lines = withInlineChanges(diffLines('abc', 'xyz'))
    expect(lines.every((l) => !l.segments)).toBe(true)
  })

  it('emoji 不会被拆开', () => {
    const lines = withInlineChanges(diffLines('写法 ✅ 正确', '写法 ❌ 正确'))
    expect(lines[1]!.segments!.find((s) => s.changed)!.text).toBe('❌')
  })
})
