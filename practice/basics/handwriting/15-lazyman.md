---
title: 手写 LazyMan
---

## 要求

实现 `LazyMan(name, log)`，返回一个支持链式调用的对象。输出不用 `console.log`，而是调用 `log(一行文字)`，测试会把每一行记下来检查顺序。题目里 sleep 的单位是秒，这里改成**毫秒**，测试跑得快一些。

- 创建后先输出 `Hi, I am 名字`
- `eat(food)`：输出 `Eat food`
- `sleep(ms)`：等 `ms` 毫秒后输出 `Wake up after 毫秒数ms`，后面的任务要等它结束才执行
- `sleepFirst(ms)`：和 sleep 一样等待并输出，但排在**所有任务的最前面**，连打招呼也要等它
- 每个方法都返回实例本身
- 任务等同步的链式调用全部结束后才开始执行：调用 `LazyMan(...)` 的那一刻什么都不输出
- 等待不能阻塞线程；同时存在的几个 LazyMan 各走各的，互不影响

```js
LazyMan('Tony', log).eat('lunch').sleepFirst(50).sleep(30).eat('dinner')
// 等 50ms：Wake up after 50ms
// Hi, I am Tony
// Eat lunch
// 再等 30ms：Wake up after 30ms
// Eat dinner
```

## 提示

- 用一个任务队列：每个方法只是把一个函数放进队列，然后 `return this`
- 构造函数里用 `setTimeout(..., 0)` 推迟启动，这时整条链已经登记完，队列是完整的
- 每个任务做完自己的事后调用 `next()` 取出下一个；sleep 任务在定时器回调里再调 next，后面的任务自然就等着了
- sleepFirst 用 `unshift` 插到队首

## 起始代码

```js
class LazyManImpl {
  constructor(name, log) {
    // 输出都交给 log(文字)
  }

  eat(food) {}

  sleep(ms) {}

  sleepFirst(ms) {}
}

const LazyMan = (name, log = console.log) => new LazyManImpl(name, log)
```

## 测试

```js
// 把 log 输出的每一行记进数组
function recorder() {
  const lines = []
  return [lines, (text) => lines.push(text)]
}

test('只调用 LazyMan 也会打招呼', async () => {
  const [lines, log] = recorder()
  LazyMan('Tony', log)
  await delay(20)
  expect(lines).toEqual(['Hi, I am Tony'])
})

test('每个方法都返回实例本身', () => {
  const man = LazyMan('Tony', () => {})
  expect(man.eat('lunch')).toBe(man)
  expect(man.sleep(10)).toBe(man)
  expect(man.sleepFirst(10)).toBe(man)
})

test('整条链登记完才开始执行，eat 按调用顺序输出', async () => {
  const [lines, log] = recorder()
  LazyMan('Tony', log).eat('lunch').eat('dinner')
  expect(lines).toEqual([])
  await delay(20)
  expect(lines).toEqual(['Hi, I am Tony', 'Eat lunch', 'Eat dinner'])
})

test('sleep 期间后面的任务要等着', async () => {
  const [lines, log] = recorder()
  LazyMan('Tony', log).sleep(50).eat('lunch')
  await delay(20)
  expect(lines).toEqual(['Hi, I am Tony'])
  await delay(80)
  expect(lines).toEqual(['Hi, I am Tony', 'Wake up after 50ms', 'Eat lunch'])
})

test('多个 sleep 一个接一个地等', async () => {
  const [lines, log] = recorder()
  LazyMan('Tony', log).sleep(40).eat('lunch').sleep(40).eat('dinner')
  await delay(60)
  expect(lines).toEqual(['Hi, I am Tony', 'Wake up after 40ms', 'Eat lunch'])
  await delay(70)
  expect(lines).toEqual(['Hi, I am Tony', 'Wake up after 40ms', 'Eat lunch', 'Wake up after 40ms', 'Eat dinner'])
})

test('sleepFirst 排在最前面，打招呼也要等它', async () => {
  const [lines, log] = recorder()
  LazyMan('Tony', log).eat('lunch').sleepFirst(50).eat('dinner')
  await delay(20)
  expect(lines).toEqual([])
  await delay(80)
  expect(lines).toEqual(['Wake up after 50ms', 'Hi, I am Tony', 'Eat lunch', 'Eat dinner'])
})

test('两个 LazyMan 各走各的，一个在 sleep 不耽误另一个', async () => {
  const [a, logA] = recorder()
  const [b, logB] = recorder()
  LazyMan('A', logA).sleep(60).eat('a')
  LazyMan('B', logB).eat('b')
  await delay(20)
  expect(b).toEqual(['Hi, I am B', 'Eat b'])
  expect(a).toEqual(['Hi, I am A'])
  await delay(80)
  expect(a).toEqual(['Hi, I am A', 'Wake up after 60ms', 'Eat a'])
})
```

## 参考答案

```js
class LazyManImpl {
  constructor(name, log) {
    this.log = log
    this.tasks = []
    this.tasks.push(() => {
      this.log(`Hi, I am ${name}`)
      this.next()
    })
    // 等同步的链式调用全部登记完，再开始执行
    setTimeout(() => this.next(), 0)
  }

  next() {
    const task = this.tasks.shift()
    if (task) task()
  }

  sleepTask(ms) {
    return () => setTimeout(() => {
      this.log(`Wake up after ${ms}ms`)
      this.next()
    }, ms)
  }

  eat(food) {
    this.tasks.push(() => {
      this.log(`Eat ${food}`)
      this.next()
    })
    return this
  }

  sleep(ms) {
    this.tasks.push(this.sleepTask(ms))
    return this
  }

  sleepFirst(ms) {
    this.tasks.unshift(this.sleepTask(ms)) // 插到队首，排在打招呼之前
    return this
  }
}

const LazyMan = (name, log = console.log) => new LazyManImpl(name, log)
```
