---
title: 手写并发控制调度器
---

## 要求

实现 `runWithLimit(tasks, limit)`：带并发上限地执行一组异步任务。

- `tasks` 是函数数组，每个函数调用后返回 Promise；也可能直接返回普通值，或者同步抛错
- 按传入顺序启动任务，同时最多有 `limit` 个在执行
- 一个任务结束（无论成功还是失败）就立刻启动下一个，而不是等同一批的全部结束
- 返回一个 Promise，全部任务结束后成功，结果是一个数组：
  - 顺序和 `tasks` 一致，和完成的先后无关
  - 每一项的格式和 `Promise.allSettled` 一样：`{ status: 'fulfilled', value }` 或 `{ status: 'rejected', reason }`
- 一个任务失败不影响其他任务，返回的 Promise 本身不会失败
- `tasks` 是空数组时，得到空数组

## 提示

- 用三个变量记录进度：下一个要启动的任务下标、正在执行的数量、已经结束的数量；写一个 `launch` 函数，有空位并且还有任务时就循环启动
- 每个任务结束时（成功和失败都要处理），正在执行的数量减一，再调用 `launch` 补位；全部结束时 resolve 结果数组
- 结果按任务下标写入 `results[i]`；用 `new Promise((r) => r(task()))` 包一层，同步抛错和返回普通值都能当成 Promise 处理
- 空数组要单独处理，否则永远等不到"全部结束"

## 起始代码

```js
function runWithLimit(tasks, limit) {
  // 返回 Promise，结果的格式和 Promise.allSettled 一样
}
```

## 测试

```js
// 生成模拟任务，并记录启动顺序和同时在执行的最大数量
function createTracker() {
  const state = { started: [], running: 0, max: 0 }
  const task = (id, ms, fail = false) => () => {
    state.started.push(id)
    state.running++
    state.max = Math.max(state.max, state.running)
    return delay(ms).then(() => {
      state.running--
      if (fail) throw new Error(`任务 ${id} 失败`)
      return `结果 ${id}`
    })
  }
  return { state, task }
}

test('结果按传入顺序排列，格式和 Promise.allSettled 一样', async () => {
  const { task } = createTracker()
  const results = await runWithLimit([task(1, 40), task(2, 10), task(3, 20)], 2)
  expect(results).toEqual([
    { status: 'fulfilled', value: '结果 1' },
    { status: 'fulfilled', value: '结果 2' },
    { status: 'fulfilled', value: '结果 3' },
  ])
})

test('按顺序启动，同时执行的任务不超过 limit 个', async () => {
  const { state, task } = createTracker()
  const tasks = [1, 2, 3, 4, 5, 6].map((id) => task(id, 10 + (id % 3) * 10))
  await runWithLimit(tasks, 2)
  expect(state.started).toEqual([1, 2, 3, 4, 5, 6])
  expect(state.max).toBe(2)
})

test('结束一个立刻补一个，不等同一批的其他任务', async () => {
  const started = []
  let startedWhenSlowEnds = null
  const slow = () => {
    started.push('慢')
    return delay(100).then(() => {
      startedWhenSlowEnds = [...started]
    })
  }
  const quick = (id) => () => {
    started.push(id)
    return delay(20)
  }
  await runWithLimit([slow, quick('A'), quick('B'), quick('C')], 2)
  // 慢任务执行期间，另一个名额先后跑完 A、B、C
  expect(startedWhenSlowEnds).toEqual(['慢', 'A', 'B', 'C'])
})

test('一个任务失败不影响其他任务，失败记录在对应的位置', async () => {
  const { task } = createTracker()
  const results = await runWithLimit([task(1, 40), task(2, 10, true), task(3, 10)], 2)
  expect(results[0]).toEqual({ status: 'fulfilled', value: '结果 1' })
  expect(results[1].status).toBe('rejected')
  expect(results[1].reason.message).toBe('任务 2 失败')
  expect(results[2]).toEqual({ status: 'fulfilled', value: '结果 3' })
})

test('任务失败后也要释放名额，后面的任务照常执行', async () => {
  const { state, task } = createTracker()
  const results = await runWithLimit([task(1, 10, true), task(2, 10, true), task(3, 10)], 1)
  expect(state.started).toEqual([1, 2, 3])
  expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'fulfilled'])
})

test('任务同步抛错或返回普通值也能处理', async () => {
  const results = await runWithLimit([
    () => {
      throw new Error('同步出错')
    },
    () => 42,
  ], 2)
  expect(results[0].status).toBe('rejected')
  expect(results[0].reason.message).toBe('同步出错')
  expect(results[1]).toEqual({ status: 'fulfilled', value: 42 })
})

test('空数组直接得到空数组', async () => {
  await expect(runWithLimit([], 3)).resolves.toEqual([])
})
```

## 参考答案

```js
function runWithLimit(tasks, limit) {
  return new Promise((resolve) => {
    const results = new Array(tasks.length)
    let next = 0 // 下一个要启动的任务下标
    let running = 0 // 正在执行的任务数
    let settled = 0 // 已经结束的任务数
    if (tasks.length === 0) return resolve(results)
    function launch() {
      // 有空位、还有任务就继续启动：一开始跑满 limit 个，之后完成一个补一个
      while (running < limit && next < tasks.length) {
        const i = next++
        running++
        new Promise((r) => r(tasks[i]())) // 任务同步抛错也会变成 rejected
          .then(
            (value) => (results[i] = { status: 'fulfilled', value }), // 按下标存，和完成顺序无关
            (reason) => (results[i] = { status: 'rejected', reason }), // 失败只记录，不影响其他任务
          )
          .then(() => {
            running--
            settled++
            settled === tasks.length ? resolve(results) : launch()
          })
      }
    }
    launch()
  })
}
```
