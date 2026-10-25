---
title: 手写异步任务串行和红绿灯
---

## 要求

实现三个函数：

**`runInOrder(tasks)`**：`tasks` 是一组"返回 Promise 的函数"（也可能直接返回普通值），按顺序一个接一个地执行。

- 上一个任务的 Promise 成功之后，才调用下一个任务
- 返回一个 Promise，成功时得到按任务顺序排列的结果数组
- 某个任务失败时，整体以同样的原因失败，后面的任务不再调用

**`sleep(ms, signal)`**：返回一个 Promise，`ms` 毫秒后成功。`signal` 是可选的 `AbortSignal`：

- 等待中 signal 被中断，立刻以 `signal.reason` 失败，不用等到时间
- 传进来的 signal 已经中断了，直接以 `signal.reason` 失败

**`trafficLight(lights, show, signal)`**：红绿灯。`lights` 形如 `[['红', 3000], ['绿', 2000], ['黄', 1000]]`，题目里的时长写死在代码里，这里改成参数，测试用几十毫秒。

- 按顺序亮灯：亮灯时调用 `show(颜色)`，等够这盏灯的毫秒数再换下一盏，最后一盏之后回到第一盏，一直循环
- 测试用 `controller.abort()`（不传参数）中断 signal：红绿灯要马上停下，正在等的那盏灯不用等完，返回的 Promise **正常成功**，不把中断当成错误抛出

## 提示

- runInOrder：在 `for...of` 里逐个 `await task()` 最直观；也可以用 reduce 把任务串成一条 then 链，初始值是 `Promise.resolve()`。不要用 forEach，它不会等回调返回的 Promise
- sleep：先检查 `signal.aborted`，再用 `signal.addEventListener('abort', ...)` 监听，回调里清掉定时器并 reject；signal 可能没传，用 `?.` 访问
- trafficLight：`while (true)` 里遍历 lights，每盏灯 show 之后 `await sleep(ms, signal)`，把 signal 传下去才能打断正在进行的等待
- 中断后 sleep 会以 `signal.reason` 失败，`abort()` 不传参数时它是一个 name 为 `AbortError` 的错误；trafficLight 用 try/catch 接住它，别的错误继续抛出

## 起始代码

```js
function runInOrder(tasks) {
  // 返回 Promise，结果是按任务顺序排列的数组
}

function sleep(ms, signal) {
  // 返回 Promise，ms 毫秒后成功；signal 中断时失败
}

function trafficLight(lights, show, signal) {
  // 循环亮灯，signal 中断后停下
}
```

## 测试

```js
test('runInOrder 按任务顺序返回结果', async () => {
  const job = (name, ms) => () => delay(ms, name)
  await expect(runInOrder([job('A', 30), job('B', 10), job('C', 20)])).resolves.toEqual(['A', 'B', 'C'])
})

test('runInOrder 上一个任务结束后才调用下一个', async () => {
  const log = []
  const job = (name, ms) => () => {
    log.push('开始 ' + name)
    return delay(ms).then(() => {
      log.push('结束 ' + name)
      return name
    })
  }
  await runInOrder([job('A', 30), job('B', 10), job('C', 20)])
  expect(log).toEqual(['开始 A', '结束 A', '开始 B', '结束 B', '开始 C', '结束 C'])
})

test('runInOrder 有任务失败时整体失败，后面的任务不再调用', async () => {
  const third = fn(() => delay(10, 'C'))
  const tasks = [() => delay(10, 'A'), () => delay(10, '第二个任务失败', true), third]
  await expect(runInOrder(tasks)).rejects.toThrow('第二个任务失败')
  expect(third).not.toHaveBeenCalled()
})

test('sleep 等够指定的毫秒数后成功', async () => {
  const start = Date.now()
  const p = sleep(50)
  expect(p).toBeInstanceOf(Promise)
  await p
  expect(Date.now() - start).toBeGreaterThanOrEqual(45)
})

test('sleep 等待中被中断，立刻以 signal.reason 失败', async () => {
  const controller = new AbortController()
  const reason = new Error('不等了')
  const start = Date.now()
  setTimeout(() => controller.abort(reason), 20)
  await expect(sleep(500, controller.signal)).rejects.toBe(reason)
  expect(Date.now() - start).toBeLessThan(200)
})

test('sleep 拿到已经中断的 signal，直接失败', async () => {
  const controller = new AbortController()
  const reason = new Error('早就取消了')
  controller.abort(reason)
  const start = Date.now()
  await expect(sleep(500, controller.signal)).rejects.toBe(reason)
  expect(Date.now() - start).toBeLessThan(200)
})

test('trafficLight 按顺序循环亮灯，每盏灯亮够时长', async () => {
  const lights = [['红', 30], ['绿', 20], ['黄', 10]]
  const controller = new AbortController()
  const seen = []
  const start = Date.now()
  await trafficLight(lights, (color) => {
    seen.push(color)
    if (seen.length === 5) controller.abort() // 亮到第 5 盏灯时停下
  }, controller.signal)
  expect(seen).toEqual(['红', '绿', '黄', '红', '绿'])
  // 第 5 盏灯亮之前，已经等了 30 + 20 + 10 + 30 = 90ms
  expect(Date.now() - start).toBeGreaterThanOrEqual(80)
})

test('trafficLight 中断后马上停下，Promise 正常成功', async () => {
  const lights = [['红', 500], ['绿', 500]]
  const controller = new AbortController()
  const seen = []
  const start = Date.now()
  setTimeout(() => controller.abort(), 30)
  await trafficLight(lights, (color) => seen.push(color), controller.signal)
  expect(seen).toEqual(['红'])
  expect(Date.now() - start).toBeLessThan(300)
})
```

## 参考答案

```js
async function runInOrder(tasks) {
  const results = []
  // 每次 await 等上一个任务落定，再调用下一个
  for (const task of tasks) results.push(await task())
  return results
}

// signal 触发时清掉定时器并拒绝
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

async function trafficLight(lights, show, signal) {
  try {
    while (true) {
      for (const [color, ms] of lights) {
        show(color)
        await sleep(ms, signal)
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err // 只吞掉中断，别的错误照常抛出
  }
}
```
