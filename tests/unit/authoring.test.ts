import { describe, expect, it } from 'vitest'
import { buildDraftMessages, buildReviseMessages, buildTopicMessages, parseTopicSuggestions } from '../../server/utils/authoring'
import { cleanGeneratedMarkdown } from '#shared/utils/authoring'

const context = {
  part: '全栈基础',
  category: 'JavaScript',
  siblings: [
    { title: '说说浏览器的事件循环（Event Loop）', path: '/basics/javascript/01-event-loop' },
    { title: '什么是闭包？', path: '/basics/javascript/02-closure' },
  ],
}
const question = { title: '`Promise.all` 和 `Promise.allSettled` 的区别？', difficulty: 2 }

describe('AI 起草的提示词', () => {
  const [system, user] = buildDraftMessages({ guide: '# 题目写作规范\n只链接已经存在的题目', question, context, notes: '讲清失败时的行为', example: 'x'.repeat(20_000) })

  it('系统提示带上写作规范和输出要求', () => {
    expect(system!.role).toBe('system')
    expect(system!.content).toContain('<guide>\n# 题目写作规范\n只链接已经存在的题目\n</guide>')
    expect(system!.content).toContain('第一行是"::: tip 一句话回答"')
  })

  it('用户消息有题目、难度、要点、同分类题目和截断后的参考题', () => {
    expect(user!.content).toContain('【题目】Promise.all 和 Promise.allSettled 的区别？')
    expect(user!.content).toContain('【难度】2（进阶）')
    expect(user!.content).toContain('<notes>\n讲清失败时的行为\n</notes>')
    expect(user!.content).toContain('- 什么是闭包？（/basics/javascript/02-closure）')
    expect(user!.content).toContain('……（后面省略）')
    expect(user!.content.length).toBeLessThan(10_000)
  })

  it('没有要点和参考题时不出现对应段落', () => {
    const [, plain] = buildDraftMessages({ guide: 'g', question, context: { ...context, siblings: [] } })
    expect(plain!.content).not.toContain('<notes>')
    expect(plain!.content).not.toContain('<example>')
    expect(plain!.content).toContain('（这个分类还没有题目）')
  })
})

describe('AI 改写的提示词', () => {
  const build = (request: Parameters<typeof buildReviseMessages>[0]['request']) =>
    buildReviseMessages({ guide: 'g', question, context, content: '\n::: tip 一句话回答\n原文\n:::\n', request })[1]!.content

  it('修复格式问题：列出问题，要求其余内容不动', () => {
    const text = build({ mode: 'lint', issues: ['第 8 行：正文出现 HTML 标签', '缺少"## 易错点"'] })
    expect(text).toContain('<issues>\n- 第 8 行：正文出现 HTML 标签\n- 缺少"## 易错点"\n</issues>')
    expect(text).toContain('其余内容一字不改')
    expect(text).toContain('<content>\n::: tip 一句话回答\n原文\n:::\n</content>')
  })

  it('参考面试反馈：带上次数、平均分和每次指出的遗漏', () => {
    const text = build({ mode: 'feedback', feedback: [{ score: 3, missing: '- 没讲失败时的行为' }, { score: null, missing: '' }, { score: 5, missing: '- 混淆了两者' }] })
    expect(text).toContain('共 3 次面试，第一轮平均 4.0 分')
    expect(text).toContain('--- 第 1 次（3 分）\n- 没讲失败时的行为')
    expect(text).toContain('--- 第 2 次（? 分）\n（没有指出遗漏）')
  })

  it('按要求修改：要求放在标签里', () => {
    expect(build({ mode: 'custom', instruction: '代码示例改成 TypeScript' })).toContain('<instruction>\n代码示例改成 TypeScript\n</instruction>')
  })
})

describe('选题建议', () => {
  it('提示词列出已有题目和想补充的方向', () => {
    const [, user] = buildTopicMessages({ context, count: 6, hint: '性能优化' })
    expect(user!.content).toContain('- 说说浏览器的事件循环（Event Loop）（/basics/javascript/01-event-loop）')
    expect(user!.content).toContain('<notes>\n性能优化\n</notes>')
    expect(user!.content).toContain('请给出 6 道。')
  })

  it('解析"难度|题目|理由"，跳过格式不对和重复的', () => {
    const text = [
      '1. 2|`Promise.all` 和 `Promise.allSettled` 的区别？|高频对比',
      '- 3｜如何设计前端监控 SDK？｜综合题',
      '说说浏览器的事件循环（Event Loop）',
      '1|什么是闭包|和已有题目重复',
      '2|如何设计前端监控 SDK|和上一条重复',
      '4|难度不对|跳过',
    ].join('\n')
    expect(parseTopicSuggestions(text, context.siblings.map((s) => s.title))).toEqual([
      { difficulty: 2, title: '`Promise.all` 和 `Promise.allSettled` 的区别？', reason: '高频对比' },
      { difficulty: 3, title: '如何设计前端监控 SDK？', reason: '综合题' },
    ])
  })

  it('最多返回 max 道', () => {
    const text = Array.from({ length: 10 }, (_, i) => `2|题目 ${i}？|理由`).join('\n')
    expect(parseTopicSuggestions(text, [], 3)).toHaveLength(3)
  })
})

describe('整理 AI 生成的正文', () => {
  it('去掉包住全文的代码块、frontmatter 和一级标题', () => {
    const raw = '```markdown\n---\ndifficulty: 2\n---\n\n# 标题\n\n::: tip 一句话回答\n内容\n:::\n\n```js\nconsole.log(1)\n```\n```'
    expect(cleanGeneratedMarkdown(raw)).toBe('::: tip 一句话回答\n内容\n:::\n\n```js\nconsole.log(1)\n```\n')
  })

  it('正常的正文只整理首尾空白', () => {
    expect(cleanGeneratedMarkdown('\n\n::: tip 一句话回答\n内容\n:::\n\n\n')).toBe('::: tip 一句话回答\n内容\n:::\n')
  })

  it('正文里的代码块不受影响', () => {
    const body = '::: tip 一句话回答\n内容\n:::\n\n```js\nconst a = 1\n```\n'
    expect(cleanGeneratedMarkdown(body)).toBe(body)
  })
})
