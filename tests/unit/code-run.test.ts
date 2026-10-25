import { describe, expect, it } from 'vitest'
import { prepareRun } from '../../shared/utils/code-prep'
import { FORMAT_SOURCE, RUNNER_HTML } from '../../server/utils/code-runner-page'

/** 运行页里的格式化函数是字符串，取出来单独测 */
const formatValue = new Function(`${FORMAT_SOURCE}; return formatValue`)() as (value: unknown, top: boolean) => string

describe('代码运行前的准备', () => {
  it('没有前面的代码块时原样运行，末尾通知运行页"执行完了"', () => {
    const r = prepareRun('console.log(1)')
    expect(r).toMatchObject({ ok: true, blockStartLine: 1, preludeCount: 0 })
    if (r.ok) expect(r.source).toBe('console.log(1)\n;__done();')
  })

  it('带上前面代码块里的函数、类和变量，演示语句不带，并且静音', () => {
    const first = [
      'function curry(fn) { return fn }',
      'class Box {}',
      'const add = curry((a, b) => a + b)',
      'console.log(add(1, 2)) // 演示',
      'add(3, 4)',
    ].join('\n')
    const r = prepareRun('console.log(curry(Math.max)(1, 2))', [first])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preludeCount).toBe(1)
    expect(r.source).toContain('function curry(fn) { return fn }')
    expect(r.source).toContain('class Box {}')
    expect(r.source).toContain('const add = curry((a, b) => a + b)')
    expect(r.source).not.toContain('演示')
    expect(r.source).not.toContain('add(3, 4)')
    expect(r.source.indexOf('__mute(true)')).toBeLessThan(r.source.indexOf('function curry'))
    expect(r.source.indexOf('__mute(false)')).toBeLessThan(r.source.indexOf('console.log(curry'))
    // 当前代码块从第几行开始，用来换算报错行号
    expect(r.source.split('\n')[r.blockStartLine - 1]).toBe('console.log(curry(Math.max)(1, 2))')
  })

  it('同名定义以后面的为准；当前代码块自己定义了的不再带前面的', () => {
    const r = prepareRun('const sum = (a, b) => a + b\nconsole.log(sum(1, 2), twice(2))', [
      'function twice(x) { return x * 2 }\nconst sum = () => 0',
      'function twice(x) { return x + x }',
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).not.toContain('x * 2')
    expect(r.source).toContain('x + x')
    expect(r.source).not.toContain('() => 0')
    expect(r.preludeCount).toBe(1)
  })

  it('去掉 export；有 import 的不能运行；语法错误带行号', () => {
    const r = prepareRun('export function a() {}\nexport default class {}\nconst b = 1\nexport { b }')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.source).toBe('function a() {}\nconst __default = class {}\nconst b = 1\n\n;__done();')
    expect(prepareRun("import { ref } from 'vue'\nref(1)")).toMatchObject({ ok: false, line: 1 })
    const bad = prepareRun('const a = 1\nconst b = (')
    expect(bad).toMatchObject({ ok: false, line: 2 })
    if (!bad.ok) expect(bad.message).toMatch(/^语法错误：/)
  })

  it('每个循环体开头插入循环保护，没有花括号的循环体补上', () => {
    const r = prepareRun('for (let i = 0; i < 3; i++) { x() }\nwhile (true) y()\ndo z(); while (0)\nfor (const k of a) for (const j in b) w()')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toContain('for (let i = 0; i < 3; i++) {__loopGuard(); x() }')
    expect(r.source).toContain('while (true) {__loopGuard();y()}')
    expect(r.source).toContain('do {__loopGuard();z();} while (0)')
    expect(r.source).toContain('for (const k of a) {__loopGuard();for (const j in b) {__loopGuard();w()}}')
  })

  it('注释里写了结果的顶层表达式显示返回值；打印、赋值、定时器、没写注释的不显示', () => {
    const code = [
      "stringify({ d: 1 }) // '{\"d\":1}'",
      'view({ list: [] })',
      '// <ul></ul>',
      'console.log(1) // 1',
      'state.count++ // count: 1',
      'a = 2 // 2',
      'setTimeout(f, 0) // 宏任务',
      'await load() // ok',
      'quiet()',
    ].join('\n')
    const r = prepareRun(code)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const lines = r.source.split('\n')
    expect(lines[0]).toBe("__show((stringify({ d: 1 }))) // '{\"d\":1}'")
    expect(lines[1]).toBe('__show((view({ list: [] })))')
    expect(lines[3]).toBe('console.log(1) // 1')
    expect(lines[4]).toBe('state.count++ // count: 1')
    expect(lines[5]).toBe('a = 2 // 2')
    expect(lines[6]).toBe('setTimeout(f, 0) // 宏任务')
    expect(lines[7]).toBe('__show((await load())) // ok')
    expect(lines[8]).toBe('quiet()')
    expect(r.onlyDeclarations).toBe(false)
    expect(prepareRun('export function a() {}\nconst b = 1;')).toMatchObject({ ok: true, onlyDeclarations: true })
  })

  it('往原型上挂方法的语句也算定义，后面的代码块会带上；带打印的不算', () => {
    const first = [
      'function myMap() {}',
      'for (const [name, fn] of Object.entries({ myMap })) {',
      '  Object.defineProperty(Array.prototype, name, { value: fn })',
      '}',
      'Foo.prototype.say = function () {}',
      'Array.prototype.demo = 1; console.log([].demo)',
    ].join('\n')
    expect(prepareRun(first)).toMatchObject({ ok: true, onlyDeclarations: false })
    const r = prepareRun('console.log([1].myMap(String))', [first])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toContain('Object.defineProperty(Array.prototype, name, { value: fn })')
    expect(r.source).toContain('Foo.prototype.say = function () {}')
    expect(r.source).not.toContain('[].demo')
    expect(prepareRun(first.split('\n').slice(0, 5).join('\n'))).toMatchObject({ ok: true, onlyDeclarations: true })
  })

  it('前面的代码块有语法错误或者不完整时跳过它', () => {
    const r = prepareRun('ok()', ['function (', 'function ok() {}'])
    expect(r).toMatchObject({ ok: true, preludeCount: 1 })
  })
})

describe('运行页的输出格式（和 Node 的 console.log 一致）', () => {
  it('顶层字符串原样输出，嵌套的加引号', () => {
    expect(formatValue('hi', true)).toBe('hi')
    expect(formatValue(['a', "it's"], true)).toBe("[ 'a', 'it\\'s' ]")
  })

  it('数组、对象、Map、Set、类实例', () => {
    expect(formatValue([1, 2, [3, [4]]], true)).toBe('[ 1, 2, [ 3, [ 4 ] ] ]')
    expect(formatValue([], true)).toBe('[]')
    expect(formatValue([{ id: 1, name: 'Tom' }], true)).toBe("[ { id: 1, name: 'Tom' } ]")
    expect(formatValue({}, true)).toBe('{}')
    expect(formatValue({ 'a-b': 1 }, true)).toBe("{ 'a-b': 1 }")
    expect(formatValue(new Map([['a', 1]]), true)).toBe("Map(1) { 'a' => 1 }")
    expect(formatValue(new Set([1, 2]), true)).toBe('Set(2) { 1, 2 }')
    class Dog {
      name = 'wang'
    }
    expect(formatValue(new Dog(), true)).toBe("Dog { name: 'wang' }")
    expect(formatValue(Object.create(null), true)).toBe('[Object: null prototype] {}')
  })

  it('特殊值：空位、-0、bigint、函数、类、错误、循环引用、太深', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(formatValue([1, , , 2], true)).toBe('[ 1, <2 empty items>, 2 ]')
    expect(formatValue(-0, true)).toBe('-0')
    expect(formatValue(10n, true)).toBe('10n')
    expect(formatValue(function named() {}, true)).toBe('[Function: named]')
    expect(formatValue(class A {}, true)).toBe('[class A]')
    expect(formatValue(new TypeError('bad'), true)).toBe('TypeError: bad')
    expect(formatValue(Symbol('s'), true)).toBe('Symbol(s)')
    const self: Record<string, unknown> = { a: 1 }
    self.self = self
    expect(formatValue(self, true)).toBe('{ a: 1, self: [Circular *] }')
    expect(formatValue({ a: { b: { c: { d: { e: 1 } } } } }, true)).toBe('{ a: { b: { c: { d: [Object] } } } }')
  })

  it('运行页本身：禁止联网、提供运行要用的全局函数，脚本里没有被模板替换坏的地方', () => {
    expect(RUNNER_HTML).toContain('function formatValue(')
    expect(RUNNER_HTML).not.toContain('/*FORMAT*/')
    for (const name of ['__mute', '__loopGuard', '__done', '__show']) expect(RUNNER_HTML).toContain(`window.${name} =`)
    // 整页只有一个 </script>，脚本内容不会提前结束
    expect(RUNNER_HTML.match(/<\/script>/g)).toHaveLength(1)
  })
})
