import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionFile } from '../../server/utils/content-file'
import { answerSummary } from '../../server/utils/markdown'

const tip = (body: string) => `::: tip 一句话回答\n${body}\n:::\n\n## 详细解析\n\n正文`

describe('answerSummary：题目页描述', () => {
  it('取一句话回答，去掉加粗但不在中文之间留空格', () => {
    expect(answerSummary(tip('每轮先执行**一个宏任务**，再清空全部~~宏~~微任务。'))).toBe('每轮先执行一个宏任务，再清空全部宏微任务。')
    expect(answerSummary(tip('先看**结论**：可以。'))).toBe('先看结论：可以。')
  })

  it('行内代码原样保留，里面的 | 和下划线不会被当成 Markdown 符号', () => {
    expect(answerSummary(tip('写法是 `` `on${Name}` ``，比如 `[Symbol.iterator]()`。'))).toBe('写法是 `on${Name}`，比如 [Symbol.iterator]()。')
    expect(answerSummary(tip('用 `|` 串起来：`prompt | model | parser`，再看 `__proto__`。'))).toBe(
      '用 | 串起来：prompt | model | parser，再看 __proto__。',
    )
  })

  it('链接只留文字', () => {
    expect(answerSummary(tip('见 [MDN 文档](https://developer.mozilla.org) 的说明。'))).toBe('见 MDN 文档 的说明。')
  })

  it('太长时在句末截断；句末太靠前就硬截并加省略号', () => {
    const long = `${'甲'.repeat(80)}。${'乙'.repeat(80)}。`
    expect(answerSummary(tip(long), 110)).toBe(`${'甲'.repeat(80)}。`)
    const noStop = `短句。${'丙'.repeat(200)}`
    const s = answerSummary(tip(noStop), 110)
    expect(s).toHaveLength(110)
    expect(s.endsWith('…')).toBe(true)
  })

  it('没有一句话回答时取正文开头', () => {
    expect(answerSummary('## 详细解析\n\n直接讲正文。')).toBe('详细解析 直接讲正文。')
  })

  it('content/ 里每道题都能得到 60～110 字的摘要，不残留 Markdown 标记', () => {
    const root = path.resolve(import.meta.dirname, '../../content')
    const files = fs
      .readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(root, f))
    const bad = files.filter((f) => {
      const s = answerSummary(parseQuestionFile(fs.readFileSync(f, 'utf8'), f).content)
      return s.length < 60 || s.length > 110 || /\*\*|:::|\]\(https?:|\u0000/.test(s)
    })
    expect(files.length).toBeGreaterThan(600)
    expect(bad.map((f) => path.relative(root, f))).toEqual([])
  })
})
