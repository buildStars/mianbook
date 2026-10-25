/**
 * 代码运行页 /sandbox/runner：题目页把要运行的代码通过 postMessage 发进来，这里执行并把输出发回去。
 * 题目页用 sandbox="allow-scripts" 的 iframe 打开它（没有 allow-same-origin，是独立的源，碰不到站点的 Cookie 和页面），
 * 响应头的 CSP 禁止一切网络请求。每次运行都开一个新的 iframe，删掉 iframe 就停掉了全部定时器。
 *
 * 脚本是普通字符串（不经过打包），写的时候不要用反引号和 ${}（String.raw 里 ${} 仍然会被替换）；
 * FORMAT_SOURCE 单独导出给单元测试，用 new Function 取出 formatValue 来测
 */

/** 把任意值格式化成一行文字，格式和 Node 的 console.log 一致（题目注释里的预期输出就是 Node 的格式） */
export const FORMAT_SOURCE = String.raw`
function formatValue(value, top) {
  var seen = []
  var IDENT = /^[A-Za-z_$][\w$]*$/
  function quote(s) {
    return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"
  }
  function tagOf(v) {
    return Object.prototype.toString.call(v).slice(8, -1)
  }
  function ctorName(v) {
    var proto = Object.getPrototypeOf(v)
    if (proto === null) return '[Object: null prototype]'
    var ctor = proto && proto.constructor
    var name = ctor && typeof ctor === 'function' ? ctor.name : ''
    return name === 'Object' ? '' : name
  }
  function fmt(v, depth, nested) {
    var t = typeof v
    if (v === null) return 'null'
    if (t === 'undefined') return 'undefined'
    if (t === 'string') return nested ? quote(v) : v
    if (t === 'number') return Object.is(v, -0) ? '-0' : String(v)
    if (t === 'bigint') return String(v) + 'n'
    if (t === 'boolean') return String(v)
    if (t === 'symbol') return v.toString()
    if (t === 'function') {
      var src = ''
      try { src = Function.prototype.toString.call(v) } catch (e) {}
      if (/^class[\s{]/.test(src)) return '[class ' + (v.name || '(anonymous)') + ']'
      return '[Function: ' + (v.name || '(anonymous)') + ']'
    }
    if (seen.indexOf(v) !== -1) return '[Circular *]'
    var tag = tagOf(v)
    if (tag === 'Error' || v instanceof Error) return (v.name || 'Error') + ': ' + v.message
    if (tag === 'Date') return isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString()
    if (tag === 'RegExp') return String(v)
    if (tag === 'Promise') return 'Promise { <pending> }'
    if (tag === 'WeakMap' || tag === 'WeakSet') return tag + ' { <items unknown> }'
    if (typeof Node !== 'undefined' && v instanceof Node) {
      if (v.nodeType === 3) return '#text ' + quote(v.textContent)
      if (v.nodeType !== 1) return '[' + v.nodeName + ']'
      var attrs = ''
      for (var a = 0; a < v.attributes.length; a++) attrs += ' ' + v.attributes[a].name + '="' + v.attributes[a].value + '"'
      return '<' + v.tagName.toLowerCase() + attrs + '>'
    }
    if (depth > 3) return Array.isArray(v) ? '[Array]' : '[Object]'
    seen.push(v)
    var items = []
    var out
    if (Array.isArray(v)) {
      var holes = 0
      var flush = function () {
        if (holes) items.push('<' + holes + ' empty item' + (holes > 1 ? 's' : '') + '>')
        holes = 0
      }
      for (var i = 0; i < v.length && items.length < 100; i++) {
        if (!(i in v)) { holes++; continue }
        flush()
        items.push(fmt(v[i], depth + 1, true))
      }
      flush()
      if (v.length > 100 && items.length >= 100) items.push('... ' + (v.length - 100) + ' more items')
      out = items.length ? '[ ' + items.join(', ') + ' ]' : '[]'
    } else if (tag === 'Map') {
      v.forEach(function (val, key) {
        if (items.length < 100) items.push(fmt(key, depth + 1, true) + ' => ' + fmt(val, depth + 1, true))
      })
      out = 'Map(' + v.size + ') ' + (items.length ? '{ ' + items.join(', ') + ' }' : '{}')
    } else if (tag === 'Set') {
      v.forEach(function (val) {
        if (items.length < 100) items.push(fmt(val, depth + 1, true))
      })
      out = 'Set(' + v.size + ') ' + (items.length ? '{ ' + items.join(', ') + ' }' : '{}')
    } else if (ArrayBuffer.isView(v) && typeof v.length === 'number') {
      for (var j = 0; j < v.length && j < 100; j++) items.push(fmt(v[j], depth + 1, true))
      out = tag + '(' + v.length + ') ' + (items.length ? '[ ' + items.join(', ') + ' ]' : '[]')
    } else {
      var keys = Object.keys(v)
      for (var k = 0; k < keys.length && k < 50; k++) {
        var val
        try { val = fmt(v[keys[k]], depth + 1, true) } catch (e) { val = '[Getter 出错]' }
        items.push((IDENT.test(keys[k]) ? keys[k] : quote(keys[k])) + ': ' + val)
      }
      if (keys.length > 50) items.push('... ' + (keys.length - 50) + ' more items')
      var name = ctorName(v)
      out = (name ? name + ' ' : '') + (items.length ? '{ ' + items.join(', ') + ' }' : '{}')
    }
    seen.pop()
    return out
  }
  return fmt(value, 0, !top)
}
`

/**
 * 默写练习的测试工具：test / expect（常用的 Jest 写法）、delay、fn（记录调用的假函数），run 依次执行全部用例，
 * 每条用例的结果交给 report。不依赖浏览器，单元测试和 npm run practice:check 在 Node 里用同一份
 */
export const HARNESS_SOURCE = String.raw`
function createPractice(formatValue, report, lineOf, beforeEach) {
  var tests = []
  var TEST_TIMEOUT = 3000
  var show = function (v) { return formatValue(v, false) }

  function fail(message) {
    var error = new Error(message)
    error.name = 'AssertionError'
    throw error
  }

  /** 深度相等，规则和 Jest 的 toEqual 一样：值为 undefined 的属性当作没有，NaN 等于 NaN */
  function equals(a, b, seen) {
    if (Object.is(a, b)) return true
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
    if (Object.prototype.toString.call(a) !== Object.prototype.toString.call(b)) return false
    seen = seen || []
    for (var s = 0; s < seen.length; s++) if (seen[s][0] === a && seen[s][1] === b) return true
    seen.push([a, b])
    if (a instanceof Date) return a.getTime() === b.getTime()
    if (a instanceof RegExp) return String(a) === String(b)
    if (a instanceof Map || a instanceof Set) {
      if (a.size !== b.size) return false
      var aa = Array.from(a), bb = Array.from(b)
      return aa.every(function (x) { return bb.some(function (y) { return equals(x, y, seen) }) })
    }
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false
      for (var i = 0; i < a.length; i++) if (!equals(a[i], b[i], seen)) return false
      return true
    }
    var ka = Object.keys(a).filter(function (k) { return a[k] !== undefined })
    var kb = Object.keys(b).filter(function (k) { return b[k] !== undefined })
    if (ka.length !== kb.length) return false
    return ka.every(function (k) { return Object.prototype.hasOwnProperty.call(b, k) && equals(a[k], b[k], seen) })
  }

  function thrownBy(fn) {
    if (typeof fn !== 'function') fail('toThrow 要传一个函数，比如 expect(() => f()).toThrow()')
    try {
      var result = fn()
    } catch (error) {
      return { error: error }
    }
    if (result && typeof result.then === 'function') {
      fail('函数返回的是 Promise，没有同步抛错；异步函数请用 await expect(promise).rejects.toThrow()')
    }
    return null
  }

  function matchesError(error, expected) {
    if (expected === undefined) return true
    var message = error && error.message !== undefined ? String(error.message) : String(error)
    if (typeof expected === 'string') return message.indexOf(expected) !== -1
    if (expected instanceof RegExp) return expected.test(message)
    if (typeof expected === 'function') return error instanceof expected
    return false
  }

  function matchers(actual, negate) {
    function check(pass, message, negMessage) {
      if (negate ? pass : !pass) fail(negate ? negMessage : message)
    }
    function calls() {
      if (!actual || !Array.isArray(actual.calls)) fail('只能对 fn() 创建的假函数检查调用情况')
      return actual.calls
    }
    return {
      toBe: function (expected) {
        check(Object.is(actual, expected), '期望 ' + show(expected) + '，实际是 ' + show(actual), '期望不是 ' + show(expected))
      },
      toEqual: function (expected) {
        check(equals(actual, expected), '期望 ' + show(expected) + '，实际是 ' + show(actual), '期望不等于 ' + show(expected))
      },
      toBeTruthy: function () { check(!!actual, '期望是真值，实际是 ' + show(actual), '期望是假值，实际是 ' + show(actual)) },
      toBeFalsy: function () { check(!actual, '期望是假值，实际是 ' + show(actual), '期望是真值，实际是 ' + show(actual)) },
      toBeNull: function () { check(actual === null, '期望是 null，实际是 ' + show(actual), '期望不是 null') },
      toBeUndefined: function () { check(actual === undefined, '期望是 undefined，实际是 ' + show(actual), '期望不是 undefined') },
      toBeDefined: function () { check(actual !== undefined, '期望有值，实际是 undefined', '期望是 undefined，实际是 ' + show(actual)) },
      toBeGreaterThan: function (n) { check(actual > n, '期望大于 ' + n + '，实际是 ' + show(actual), '期望不大于 ' + n + '，实际是 ' + show(actual)) },
      toBeGreaterThanOrEqual: function (n) { check(actual >= n, '期望大于等于 ' + n + '，实际是 ' + show(actual), '期望小于 ' + n + '，实际是 ' + show(actual)) },
      toBeLessThan: function (n) { check(actual < n, '期望小于 ' + n + '，实际是 ' + show(actual), '期望不小于 ' + n + '，实际是 ' + show(actual)) },
      toBeLessThanOrEqual: function (n) { check(actual <= n, '期望小于等于 ' + n + '，实际是 ' + show(actual), '期望大于 ' + n + '，实际是 ' + show(actual)) },
      toContain: function (item) {
        var has = typeof actual === 'string' ? actual.indexOf(item) !== -1 : !!actual && Array.prototype.some.call(actual, function (x) { return Object.is(x, item) })
        check(has, '期望包含 ' + show(item) + '，实际是 ' + show(actual), '期望不包含 ' + show(item))
      },
      toHaveLength: function (n) {
        var len = actual == null ? undefined : actual.length
        check(len === n, '期望长度是 ' + n + '，实际是 ' + show(len), '期望长度不是 ' + n)
      },
      toMatch: function (pattern) {
        var ok = typeof actual === 'string' && (pattern instanceof RegExp ? pattern.test(actual) : actual.indexOf(pattern) !== -1)
        check(ok, '期望匹配 ' + String(pattern) + '，实际是 ' + show(actual), '期望不匹配 ' + String(pattern))
      },
      toBeInstanceOf: function (C) {
        check(actual instanceof C, '期望是 ' + (C && C.name) + ' 的实例，实际是 ' + show(actual), '期望不是 ' + (C && C.name) + ' 的实例')
      },
      toThrow: function (expected) {
        var thrown = thrownBy(actual)
        if (negate) {
          if (thrown) fail('期望不抛错，实际抛出了 ' + show(thrown.error))
          return
        }
        if (!thrown) fail('期望抛出错误，但没有抛')
        if (!matchesError(thrown.error, expected)) fail('期望抛出 ' + show(expected) + '，实际抛出 ' + show(thrown.error))
      },
      toHaveBeenCalled: function () {
        var n = calls().length
        check(n > 0, '期望被调用过，实际一次都没调用', '期望没被调用，实际调用了 ' + n + ' 次')
      },
      toHaveBeenCalledTimes: function (times) {
        var n = calls().length
        check(n === times, '期望调用 ' + times + ' 次，实际调用了 ' + n + ' 次', '期望调用次数不是 ' + times)
      },
      toHaveBeenCalledWith: function () {
        var args = Array.prototype.slice.call(arguments)
        var list = calls()
        check(
          list.some(function (c) { return equals(c, args) }),
          '期望用 ' + show(args) + ' 调用过，实际的调用是 ' + show(list),
          '期望没有用 ' + show(args) + ' 调用过',
        )
      },
    }
  }

  function expect(actual) {
    var api = matchers(actual, false)
    api.not = matchers(actual, true)
    // await expect(promise).resolves.toBe(1) / .rejects.toThrow('x')
    api.resolves = {}
    api.rejects = {}
    Object.keys(api).forEach(function (name) {
      if (name === 'not' || name === 'resolves' || name === 'rejects') return
      api.resolves[name] = function () {
        var args = arguments
        return Promise.resolve(actual).then(
          function (value) { matchers(value, false)[name].apply(null, args) },
          function (reason) { fail('期望 Promise 成功，实际被拒绝：' + show(reason)) },
        )
      }
      api.rejects[name] = function () {
        var args = arguments
        return Promise.resolve(actual).then(
          function (value) { fail('期望 Promise 被拒绝，实际成功了，结果是 ' + show(value)) },
          function (reason) {
            var target = name === 'toThrow' ? function () { throw reason } : reason
            matchers(target, false)[name].apply(null, args)
          },
        )
      }
    })
    return api
  }

  /** 等一会儿：delay(100) 100ms 后成功；delay(100, 'a') 返回 'a'；delay(100, 'e', true) 100ms 后以 Error('e') 失败 */
  function delay(ms, value, reject) {
    return new Promise(function (resolve, rejectFn) {
      setTimeout(function () { reject ? rejectFn(value instanceof Error ? value : new Error(String(value))) : resolve(value) }, ms)
    })
  }

  /** 假函数：记下每次调用的参数（spy.calls），可以传一个实现 */
  function fn(impl) {
    var spy = function () {
      var args = Array.prototype.slice.call(arguments)
      spy.calls.push(args)
      return impl ? impl.apply(this, args) : undefined
    }
    spy.calls = []
    return spy
  }

  function test(name, body, timeout) {
    tests.push({ name: String(name), body: body, timeout: timeout || TEST_TIMEOUT })
  }

  function describeError(error) {
    if (error && error.name === 'AssertionError') return { message: error.message, line: lineOf(error) }
    if (error && typeof error === 'object' && 'message' in error) return { message: (error.name || 'Error') + ': ' + error.message, line: lineOf(error) }
    return { message: '抛出了 ' + show(error), line: null }
  }

  function runOne(t) {
    var timer
    var timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () { reject(new Error('超过 ' + t.timeout + 'ms 还没结束（Promise 一直没有 resolve？）')) }, t.timeout)
    })
    return Promise.race([Promise.resolve().then(function () { return t.body() }), timeout]).then(
      function () { clearTimeout(timer) },
      function (error) { clearTimeout(timer); throw error },
    )
  }

  async function run() {
    var passed = 0
    for (var i = 0; i < tests.length; i++) {
      var started = Date.now()
      var error = null
      // 每条用例重新计循环次数：前一条死循环被拦下后，后面的用例照常跑
      if (beforeEach) beforeEach()
      try {
        await runOne(tests[i])
      } catch (e) {
        error = describeError(e)
      }
      if (!error) passed++
      report({ index: i, name: tests[i].name, ok: !error, ms: Date.now() - started, error: error })
    }
    report({ done: true, passed: passed, total: tests.length })
    return { passed: passed, total: tests.length }
  }

  return { test: test, expect: expect, delay: delay, fn: fn, run: run }
}
`

const RUNNER_SOURCE = String.raw`
(function () {
  'use strict'
  var parentWin = window.parent
  var runId = null
  var muted = false
  var sent = 0
  var MAX_LINES = 1000
  var LOOP_LIMIT = 10000000
  var loops = 0
  var evaluated = false
  var live = new Set()
  var nativeSetTimeout = window.setTimeout
  var nativeClearTimeout = window.clearTimeout
  var nativeSetInterval = window.setInterval
  var nativeClearInterval = window.clearInterval

  /*FORMAT*/
  /*HARNESS*/

  function post(type, data) {
    parentWin.postMessage({ source: 'mianbook-runner', runId: runId, type: type, data: data }, '*')
  }

  /** printf 风格的 %s %d %o 和 %c（样式直接丢掉），其余参数用空格连起来 */
  function formatArgs(args) {
    args = Array.prototype.slice.call(args)
    var parts = []
    if (typeof args[0] === 'string' && args[0].indexOf('%') !== -1) {
      var first = args.shift()
      first = first.replace(/%([sdifoOc%])/g, function (m, f) {
        if (f === '%') return '%'
        if (!args.length) return m
        var arg = args.shift()
        if (f === 'c') return ''
        if (f === 's') return typeof arg === 'string' ? arg : formatValue(arg, false)
        if (f === 'd' || f === 'i') return String(parseInt(arg, 10))
        if (f === 'f') return String(parseFloat(arg))
        return formatValue(arg, false)
      })
      parts.push(first)
    }
    for (var i = 0; i < args.length; i++) parts.push(formatValue(args[i], true))
    return parts.join(' ')
  }

  function emit(level, text) {
    if (muted) return
    if (sent > MAX_LINES) return
    sent++
    if (sent > MAX_LINES) return post('log', { level: 'warn', text: '输出超过 ' + MAX_LINES + ' 行，后面的不再显示' })
    post('log', { level: level, text: text.length > 10000 ? text.slice(0, 10000) + ' …' : text })
  }

  var timers = {}
  var counts = {}
  var fake = {
    log: function () { emit('log', formatArgs(arguments)) },
    info: function () { emit('info', formatArgs(arguments)) },
    debug: function () { emit('log', formatArgs(arguments)) },
    warn: function () { emit('warn', formatArgs(arguments)) },
    error: function () { emit('error', formatArgs(arguments)) },
    dir: function (v) { emit('log', formatValue(v, false)) },
    table: function (v) { emit('log', formatValue(v, false)) },
    group: function () { if (arguments.length) emit('log', formatArgs(arguments)) },
    groupCollapsed: function () { if (arguments.length) emit('log', formatArgs(arguments)) },
    groupEnd: function () {},
    trace: function () { emit('log', 'Trace: ' + formatArgs(arguments)) },
    assert: function (ok) {
      if (!ok) emit('error', 'Assertion failed' + (arguments.length > 1 ? ': ' + formatArgs(Array.prototype.slice.call(arguments, 1)) : ''))
    },
    count: function (label) {
      label = label === undefined ? 'default' : String(label)
      counts[label] = (counts[label] || 0) + 1
      emit('log', label + ': ' + counts[label])
    },
    countReset: function (label) { counts[label === undefined ? 'default' : String(label)] = 0 },
    time: function (label) { timers[label === undefined ? 'default' : String(label)] = performance.now() },
    timeEnd: function (label) {
      label = label === undefined ? 'default' : String(label)
      if (timers[label] === undefined) return
      emit('log', label + ': ' + (performance.now() - timers[label]).toFixed(3) + ' ms')
      delete timers[label]
    },
    timeLog: function (label) {
      label = label === undefined ? 'default' : String(label)
      if (timers[label] !== undefined) emit('log', label + ': ' + (performance.now() - timers[label]).toFixed(3) + ' ms')
    },
    clear: function () { post('clear', null) },
  }
  Object.defineProperty(window, 'console', { value: fake, writable: true, configurable: true })

  // 定时器都记下来，没有待执行的定时器、代码也执行完了，就算运行结束
  function settle() {
    nativeSetTimeout.call(window, function () {
      if (evaluated && live.size === 0) post('idle', { dom: domInfo() })
    }, 0)
  }
  window.setTimeout = function (fn, ms) {
    var args = Array.prototype.slice.call(arguments, 2)
    var id = nativeSetTimeout.call(window, function () {
      live.delete(id)
      try {
        if (typeof fn === 'function') fn.apply(window, args)
      } finally {
        settle()
      }
    }, ms)
    live.add(id)
    return id
  }
  window.clearTimeout = function (id) {
    live.delete(id)
    nativeClearTimeout.call(window, id)
    settle()
  }
  window.setInterval = function () {
    var id = nativeSetInterval.apply(window, arguments)
    live.add(id)
    return id
  }
  window.clearInterval = function (id) {
    live.delete(id)
    nativeClearInterval.call(window, id)
    settle()
  }
  // 不可见的 iframe 里浏览器会暂停 requestAnimationFrame，换成 16ms 的定时器
  window.requestAnimationFrame = function (fn) {
    return window.setTimeout(function () { fn(performance.now()) }, 16)
  }
  window.cancelAnimationFrame = function (id) { window.clearTimeout(id) }

  window.__mute = function (on) { muted = !!on }
  // 一边遍历一边往 Set、Map 里加东西会一直遍历下去（比如响应式系统里 effect 把自己又加回依赖），forEach 也算进循环次数
  ;[Set.prototype, Map.prototype].forEach(function (proto) {
    var original = proto.forEach
    Object.defineProperty(proto, 'forEach', {
      value: function (callback, thisArg) {
        return original.call(this, function () {
          window.__loopGuard()
          return callback.apply(thisArg, arguments)
        })
      },
      writable: true,
      configurable: true,
    })
  })
  window.__loopGuard = function () {
    if (++loops > LOOP_LIMIT) throw new RangeError('循环超过 ' + LOOP_LIMIT / 10000 + ' 万次，可能是死循环，已经停下')
  }
  // 注释里写了结果的顶层表达式：显示返回值。undefined、函数、Promise 不显示；
  // 自定义类的实例也不显示（多是 LazyMan('Tony').eat() 这种链式调用返回的对象，注释写的是之后的输出）
  var PLAIN = [Object.prototype, Array.prototype, Map.prototype, Set.prototype, Date.prototype, RegExp.prototype, null]
  window.__show = function (value) {
    if (value === undefined || typeof value === 'function' || (value && typeof value.then === 'function')) return value
    if (typeof value === 'object' && !(value instanceof Error) && PLAIN.indexOf(Object.getPrototypeOf(value)) === -1) return value
    emit('result', formatValue(value, false))
    return value
  }
  // 默写练习：测试代码里的 test、expect 等从这里取，每条用例的结果发给题目页
  window.__practice = createPractice(formatValue, function (result) { post('test', result) }, lineOf, function () { loops = 0 })
  window.__done = function () {
    evaluated = true
    settle()
  }

  /** 报错位置：同步错误事件里有行号；Promise 拒绝从 stack 里找运行脚本（blob:）的行号 */
  function lineOf(error) {
    var stack = error && typeof error.stack === 'string' ? error.stack : ''
    var m = stack.match(/blob:[^\s)]+?:(\d+):\d+/)
    return m ? Number(m[1]) : null
  }
  function errorText(error, fallback) {
    if (error && typeof error === 'object' && 'message' in error) return (error.name || 'Error') + ': ' + error.message
    if (error === undefined && fallback) return fallback
    return formatValue(error, false)
  }
  window.addEventListener('error', function (e) {
    e.preventDefault()
    // 顶层代码出错时模块停止执行，不会走到 __done
    if (!evaluated) {
      evaluated = true
      settle()
    }
    // 错误在运行页自己的函数里抛出（比如循环保护）时，行号要从调用栈里找用户代码那一行
    var inUserCode = typeof e.filename === 'string' && e.filename.indexOf('blob:') === 0
    post('error', { message: errorText(e.error, e.message), line: inUserCode ? e.lineno : lineOf(e.error) })
  })
  window.addEventListener('unhandledrejection', function (e) {
    e.preventDefault()
    post('error', { message: '没有处理的 Promise 拒绝：' + errorText(e.reason), line: lineOf(e.reason) })
    settle()
  })

  /** 代码有没有往页面上放东西（比如虚拟 DOM 渲染），有就把内容高度（不是 iframe 的高度）报给题目页，显示页面预览 */
  var app = document.getElementById('app')
  function domInfo() {
    var used = app.childNodes.length > 0
    for (var i = 0; !used && i < document.body.children.length; i++) {
      var el = document.body.children[i]
      if (el !== app && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && el.tagName !== 'IFRAME') used = true
    }
    if (!used) return null
    if (window.ResizeObserver && !domInfo.watching) {
      domInfo.watching = true
      new ResizeObserver(function () { post('resize', { height: document.body.scrollHeight }) }).observe(document.body)
    }
    return { height: document.body.scrollHeight }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== parentWin || !e.data || e.data.type !== 'run' || runId !== null) return
    runId = e.data.runId
    var url = URL.createObjectURL(new Blob([e.data.code], { type: 'text/javascript' }))
    var script = document.createElement('script')
    script.type = 'module'
    script.src = url
    document.head.appendChild(script)
  })

  post('ready', null)
})()
`

export const RUNNER_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>代码运行</title>
<style>
html { color-scheme: light; }
body { margin: 0; padding: 14px 16px; font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
</style>
</head>
<body>
<div id="app"></div>
<script>${RUNNER_SOURCE.replace('/*FORMAT*/', () => FORMAT_SOURCE).replace('/*HARNESS*/', () => HARNESS_SOURCE)}</script>
</body>
</html>
`

/** 运行页的 CSP：只允许内联脚本、eval（模板引擎这类题要用 new Function）和 blob: 脚本，禁止一切网络请求 */
export const RUNNER_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')
