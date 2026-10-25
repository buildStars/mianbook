import { describe, expect, it } from 'vitest'
import { preparePractice } from '../../shared/utils/code-prep'
import { parsePracticeSpec } from '../../shared/utils/practice-spec'
import { checkPracticeFile, practiceFiles, runPractice } from '../../scripts/check-practice'

const SPEC = [
  '---',
  'title: 手写 add',
  '---',
  '',
  '## 要求',
  '',
  '实现 `add(a, b)`。',
  '',
  '## 提示',
  '',
  '- 用 `+`',
  '- 想想字符串',
  '',
  '## 起始代码',
  '',
  '```js',
  'function add(a, b) {}',
  '```',
  '',
  '## 测试',
  '',
  '```js',
  "test('加法', () => expect(add(1, 2)).toBe(3))",
  '```',
  '',
  '## 参考答案',
  '',
  '```js',
  'function add(a, b) {',
  '  return a + b',
  '}',
  '```',
].join('\n')

describe('默写练习的题目文件', () => {
  it('解析出标题、要求、提示、起始代码、测试和参考答案', () => {
    const spec = parsePracticeSpec(SPEC)
    expect(spec).toMatchObject({ title: '手写 add', dom: false, task: '实现 `add(a, b)`。', hints: ['用 `+`', '想想字符串'] })
    expect(spec.starter).toBe('function add(a, b) {}')
    expect(spec.tests).toContain("test('加法'")
    expect(spec.solution).toBe('function add(a, b) {\n  return a + b\n}')
    expect(parsePracticeSpec(SPEC.replace('title: 手写 add', 'dom: true')).dom).toBe(true)
  })

  it('缺小节、不认识的小节、小节里没有代码块都报错', () => {
    expect(() => parsePracticeSpec(SPEC.replace('## 参考答案', '## 答案'))).toThrow('不认识的小节')
    expect(() => parsePracticeSpec(SPEC.split('## 测试')[0]!)).toThrow('缺少"## 测试"')
    expect(() => parsePracticeSpec(SPEC.replace('```js\nfunction add(a, b) {}\n```', 'function add() {}'))).toThrow('起始代码')
  })
})

describe('默写练习的运行', () => {
  it('用户代码在最前面，测试包在块里，用户定义的 test 不影响测试', async () => {
    const r = preparePractice('const test = 1\nexport function add(a, b) { return a + b }', "test('x', () => expect(add(1, 2)).toBe(3))")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source.split('\n')[1]).toBe('function add(a, b) { return a + b }')
    expect(r.source).toContain('const { test, expect, delay, fn } = __practice;')
    const run = await runPractice('const test = 1\nfunction add(a, b) { return a + b }', "test('x', () => expect(add(1, 2)).toBe(3))")
    expect(run.results).toEqual([expect.objectContaining({ name: 'x', ok: true })])
  })

  it('语法错误带行号，import 不能用', () => {
    expect(preparePractice('function f() {\n  return (', '')).toMatchObject({ ok: false, line: 2 })
    expect(preparePractice("import x from 'y'", '')).toMatchObject({ ok: false, line: 1 })
  })

  it('断言：toEqual 忽略值为 undefined 的属性，失败信息写明期望和实际', async () => {
    const { results } = await runPractice(
      '',
      [
        "test('相等', () => expect({ a: 1, b: undefined, s: new Set([1]) }).toEqual({ a: 1, s: new Set([1]) }))",
        "test('不等', () => expect([1, 2]).toEqual([1, 3]))",
        "test('not', () => expect(1).not.toBe(1))",
        "test('NaN', () => expect([NaN]).toEqual([NaN]))",
      ].join('\n'),
    )
    expect(results.map((r) => r.ok)).toEqual([true, false, false, true])
    expect(results[1]!.error!.message).toBe('期望 [ 1, 3 ]，实际是 [ 1, 2 ]')
    expect(results[2]!.error!.message).toBe('期望不是 1')
  })

  it('抛错和异步：toThrow、resolves、rejects、超时', async () => {
    const { results } = await runPractice(
      '',
      [
        "test('同步抛错', () => expect(() => { throw new TypeError('坏了') }).toThrow('坏'))",
        "test('错误类型', () => expect(() => { throw new TypeError('x') }).toThrow(RangeError))",
        "test('成功', async () => { await expect(delay(5, 'a')).resolves.toBe('a') })",
        "test('拒绝', async () => { await expect(delay(5, '网络错误', true)).rejects.toThrow('网络') })",
        "test('该拒绝却成功', async () => { await expect(delay(5, 1)).rejects.toThrow() })",
        "test('超时', () => new Promise(() => {}), 50)",
      ].join('\n'),
    )
    expect(results.map((r) => r.ok)).toEqual([true, false, true, true, false, false])
    expect(results[4]!.error!.message).toBe('期望 Promise 被拒绝，实际成功了，结果是 1')
    expect(results[5]!.error!.message).toContain('超过 50ms')
  })

  it('假函数记录调用；用户代码的死循环会被拦下', async () => {
    const spy = await runPractice(
      'function callTwice(f) { f(1); f(2, 3) }',
      "test('调用', () => { const s = fn(); callTwice(s); expect(s).toHaveBeenCalledTimes(2); expect(s).toHaveBeenCalledWith(2, 3) })",
    )
    expect(spy.results[0]!.ok).toBe(true)
    const loop = await runPractice('function f() { while (true) {} }', "test('死循环', () => f())")
    expect(loop.results[0]!.error!.message).toContain('循环超过 1000 万次')
  })
})

describe('仓库里的全部默写练习', () => {
  it('格式正确、参考答案通过全部测试、起始代码通过不了', async () => {
    const files = practiceFiles()
    expect(files.length).toBeGreaterThan(0)
    const problems: string[] = []
    for (const file of files) for (const p of await checkPracticeFile(file)) problems.push(`${file}: ${p}`)
    expect(problems).toEqual([])
  }, 120_000)
})
