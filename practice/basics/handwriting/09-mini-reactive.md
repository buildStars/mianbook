---
title: 手写 reactive 和 effect
---

## 要求

实现一个简易的响应式系统：`reactive(obj)` 和 `effect(fn, options)`。

- `reactive(obj)` 返回 `obj` 的代理，读写属性和直接操作 `obj` 一样（改的就是 `obj`）
- `effect(fn)` 立即执行一次 `fn`，记下执行过程中读了哪些响应式对象的哪些属性；之后这些属性被修改，就同步重新执行 `fn`。只读过的属性会触发，不同对象的同名属性互不影响
- 每次执行都重新记录依赖：比如 `state.ok ? state.text : 'off'`，`ok` 变成 false 以后这次没有读 `text`，再改 `text` 就不触发
- 新值和旧值相同（按 `Object.is` 判断，`NaN` 等于 `NaN`）时不触发
- 嵌套的对象也是响应式的：`state.user.name = 'b'` 会触发读过 `state.user.name` 的 effect
- effect 里可以再创建 effect：内层执行完以后，外层接下来读的属性仍然记在外层上
- effect 执行过程中修改了自己依赖的属性（比如 `state.count++`），不会再次触发自己
- `effect` 返回一个函数，调用它会重新执行 `fn`（同样重新记录依赖）
- `options.scheduler`：传了的话，依赖变化时不直接执行，而是调用 `scheduler(job)`，`job` 就是 `effect` 返回的那个函数，由 scheduler 决定什么时候执行

## 提示

- 依赖存成 `WeakMap<原对象, Map<属性名, Set<effect>>>`；Proxy 的 `get` 里收集（track），`set` 里比较新旧值后触发（trigger），`set` 要返回 true
- 用一个变量记下"正在执行的 effect"，`get` 只在它存在时收集；effect 嵌套时用栈保存，内层执行完恢复成外层
- 每个 effect 反向记下自己被放进了哪些 Set，每次执行前先把自己从这些 Set 里删掉，执行时重新收集
- trigger 时遍历 Set 的副本并跳过正在执行的 effect：直接遍历原 Set，effect 执行时先被删掉又被加回去，会被再次访问到，变成死循环

## 起始代码

```js
function reactive(obj) {
  // 返回 obj 的 Proxy
}

function effect(fn, options = {}) {
  // 立即执行 fn，返回一个能重新执行它的函数
}
```

## 测试

```js
test('effect 立即执行，依赖的属性变化后重新执行', () => {
  const raw = { count: 0 }
  const state = reactive(raw)
  const seen = []
  effect(() => seen.push(state.count))
  expect(seen).toEqual([0])
  state.count = 1
  state.count++
  expect(seen).toEqual([0, 1, 2])
  expect(raw.count).toBe(2)
})

test('只有读过的属性变化才触发，不同对象互不影响', () => {
  const state = reactive({ a: 1, b: 1 })
  const other = reactive({ a: 1 })
  let runs = 0
  effect(() => {
    runs++
    return state.a
  })
  state.b = 2
  other.a = 2
  expect(runs).toBe(1)
  state.a = 2
  expect(runs).toBe(2)
})

test('值没变不触发，NaN 也算没变', () => {
  const state = reactive({ count: 0, n: NaN })
  let runs = 0
  effect(() => {
    runs++
    return [state.count, state.n]
  })
  state.count = 0
  state.n = NaN
  expect(runs).toBe(1)
})

test('嵌套的对象也是响应式的', () => {
  const state = reactive({ user: { name: 'a' } })
  const seen = []
  effect(() => seen.push(state.user.name))
  state.user.name = 'b'
  expect(seen).toEqual(['a', 'b'])
  state.user = { name: 'c' }
  expect(seen).toEqual(['a', 'b', 'c'])
})

test('分支切换后，不再读的属性变化不触发', () => {
  const state = reactive({ ok: true, text: 'hello' })
  let runs = 0
  effect(() => {
    runs++
    return state.ok ? state.text : 'off'
  })
  state.ok = false
  expect(runs).toBe(2)
  state.text = 'world' // 这时已经不依赖 text
  expect(runs).toBe(2)
  state.ok = true
  state.text = 'again'
  expect(runs).toBe(4)
})

test('嵌套 effect：内层执行完后，外层仍能收集依赖', () => {
  const state = reactive({ a: 1, b: 1 })
  let outer = 0
  effect(() => {
    outer++
    effect(() => state.b) // 内层 effect
    return state.a // 内层执行完后才读 a
  })
  state.a = 2
  expect(outer).toBe(2)
  state.b = 2 // 只有内层依赖 b
  expect(outer).toBe(2)
})

test('effect 里修改自己依赖的属性，不会无限递归', () => {
  const state = reactive({ count: 0 })
  effect(() => {
    state.count++
  })
  expect(state.count).toBe(1)
  state.count = 10
  expect(state.count).toBe(11)
})

test('scheduler：依赖变化时调用 scheduler，由它决定什么时候执行', () => {
  const state = reactive({ n: 0 })
  const jobs = []
  const seen = []
  const runner = effect(() => seen.push(state.n), { scheduler: (job) => jobs.push(job) })
  expect(typeof runner).toBe('function')
  state.n = 1
  state.n = 2
  expect(seen).toEqual([0]) // 没有直接执行
  expect(jobs).toHaveLength(2)
  expect(jobs[0]).toBe(runner)
  runner()
  expect(seen).toEqual([0, 2])
  state.n = 3 // 手动执行后依赖仍然在
  expect(jobs).toHaveLength(3)
})
```

## 参考答案

```js
const targetMap = new WeakMap()
const effectStack = []
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
  activeEffect.deps.push(dep) // 反向记录，清理时用
}

function trigger(target, key) {
  const dep = targetMap.get(target)?.get(key) ?? []
  for (const effectFn of [...dep]) { // 遍历副本
    if (effectFn === activeEffect) continue // 不触发自己
    effectFn.scheduler ? effectFn.scheduler(effectFn) : effectFn()
  }
}

function reactive(obj) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      track(target, key)
      const res = Reflect.get(target, key, receiver)
      return res !== null && typeof res === 'object' ? reactive(res) : res // 读到时才代理深层对象
    },
    set(target, key, value, receiver) {
      const oldValue = target[key]
      const ok = Reflect.set(target, key, value, receiver)
      if (!Object.is(oldValue, value)) trigger(target, key) // 值没变不触发，Object.is 能正确处理 NaN
      return ok
    },
  })
}

function effect(fn, options = {}) {
  const effectFn = () => {
    effectFn.deps.splice(0).forEach((dep) => dep.delete(effectFn)) // 清空并清理旧依赖
    effectStack.push(effectFn)
    activeEffect = effectFn
    try {
      return fn() // 执行期间重新收集依赖
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null // 恢复外层 effect
    }
  }
  Object.assign(effectFn, { deps: [], scheduler: options.scheduler })
  if (!options.lazy) effectFn() // lazy 留给 computed 用，这里的测试用不到
  return effectFn
}
```
