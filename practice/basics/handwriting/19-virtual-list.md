---
title: 手写虚拟列表的位置缓存
---

## 要求

实现不定高虚拟列表的核心计算类 `SizeCache`：列表有 `count` 项，每项高度先按预估值 `estimated` 算，渲染后测到真实高度再更新。它只做计算，不碰 DOM。

- `new SizeCache(count, estimated)`
- `setHeight(index, height)`：记下第 `index` 项的真实高度，返回新高度减旧高度的差（没变返回 0），外壳用它修正 scrollTop
- `top(index)`：第 `index` 项顶部的位置，也就是它前面所有项的高度之和；`top(0)` 是 0，`top(count)` 是总高度
- `totalHeight`：所有项的高度之和，是一个 getter（`cache.totalHeight`，不加括号）
- `findIndex(offset)`：位置 `offset` 落在哪一项，也就是最后一个满足 `top(i) <= offset` 的 `i`；`offset` 小于 0 时返回 0，超过总高度时返回最后一项 `count - 1`
- `getRange(scrollTop, viewportHeight, buffer = 5)`：返回要渲染的区间 `{ start, end, offset }`。可视区是 `[scrollTop, scrollTop + viewportHeight)` 这一段：`start` 是可视区里第一项的下标减 `buffer`，`end` 是可视区里最后一项的下标加 `1 + buffer`（`end` 本身不渲染），两者都夹在 `[0, count]` 之间；`offset` 是 `top(start)`，也就是内容层要往下平移的距离

```js
const cache = new SizeCache(100, 50) // 100 项，每项预估 50px
cache.getRange(500, 300, 2) // { start: 8, end: 18, offset: 400 }：可视区是第 10～15 项，前后各多渲染 2 项
cache.setHeight(1, 100) // 50：第 1 项比预估高了 50
cache.top(2) // 150
```

## 提示

- 存两个数组：`heights[i]` 是每一项的高度，`tops[i]` 是每一项的顶部位置，多存一个 `tops[count]` 当总高度
- 某一项高度变了，它后面所有项的 `tops` 都要跟着变。可以只记下最早变化的位置（脏标记），等到读取位置时再从那里往后重算一遍，一帧里测量几十项也只重算一次
- `tops` 是递增的，findIndex 用二分查找"最后一个 `tops[i] <= offset`"；写成"第一个 `tops[i] >= offset`"会在两项交界处差一位
- getRange 调两次 findIndex，分别找可视区第一项和最后一项（最后一项看 `scrollTop + viewportHeight - 1` 这个位置），再加上缓冲区、夹到范围内

## 起始代码

```js
class SizeCache {
  constructor(count, estimated) {}

  setHeight(index, height) {
    // 返回新旧高度的差
  }

  top(index) {}

  get totalHeight() {}

  findIndex(offset) {}

  getRange(scrollTop, viewportHeight, buffer = 5) {
    // 返回 { start, end, offset }
  }
}
```

## 测试

```js
test('一开始每项按预估高度排布', () => {
  const cache = new SizeCache(100, 50)
  expect(cache.top(0)).toBe(0)
  expect(cache.top(3)).toBe(150)
  expect(cache.top(100)).toBe(5000)
  expect(cache.totalHeight).toBe(5000)
})

test('setHeight 返回新旧高度的差', () => {
  const cache = new SizeCache(10, 50)
  expect(cache.setHeight(2, 80)).toBe(30)
  expect(cache.setHeight(2, 80)).toBe(0)
  expect(cache.setHeight(3, 20)).toBe(-30)
})

test('某一项高度变了，后面所有项的位置都跟着变', () => {
  const cache = new SizeCache(100, 50)
  cache.setHeight(1, 100)
  expect(cache.top(1)).toBe(50)
  expect(cache.top(2)).toBe(150)
  expect(cache.top(10)).toBe(550)
  expect(cache.totalHeight).toBe(5050)
})

test('多次修改高度、中间穿插读取，位置都正确', () => {
  const cache = new SizeCache(20, 50)
  cache.setHeight(5, 100)
  expect(cache.top(10)).toBe(550)
  cache.setHeight(2, 10) // 改的是前面的项
  expect(cache.top(10)).toBe(510)
  cache.setHeight(8, 0)
  cache.setHeight(5, 60) // 连改几项再读
  expect(cache.top(6)).toBe(270)
  expect(cache.top(10)).toBe(420)
  expect(cache.totalHeight).toBe(920)
})

test('findIndex 找最后一个 top <= offset 的项，交界处不差一位', () => {
  const cache = new SizeCache(10, 50)
  cache.setHeight(0, 100) // 第 0 项占 [0, 100)，第 1 项占 [100, 150)
  expect(cache.findIndex(0)).toBe(0)
  expect(cache.findIndex(99)).toBe(0)
  expect(cache.findIndex(100)).toBe(1)
  expect(cache.findIndex(149)).toBe(1)
  expect(cache.findIndex(150)).toBe(2)
})

test('findIndex 超出范围时返回第一项或最后一项', () => {
  const cache = new SizeCache(10, 50)
  expect(cache.findIndex(-20)).toBe(0)
  expect(cache.findIndex(500)).toBe(9)
  expect(cache.findIndex(99999)).toBe(9)
})

test('getRange 返回可视区加缓冲区的区间和偏移', () => {
  const cache = new SizeCache(100, 50)
  expect(cache.getRange(500, 300, 2)).toEqual({ start: 8, end: 18, offset: 400 })
  expect(cache.getRange(520, 300)).toEqual({ start: 5, end: 22, offset: 250 })
  cache.setHeight(0, 300) // 第 0 项变高，后面整体下移 250
  expect(cache.getRange(300, 100, 0)).toEqual({ start: 1, end: 3, offset: 300 })
})

test('getRange 在列表两头不越界', () => {
  const cache = new SizeCache(100, 50)
  expect(cache.getRange(0, 300, 5)).toEqual({ start: 0, end: 11, offset: 0 })
  expect(cache.getRange(4800, 300, 5)).toEqual({ start: 91, end: 100, offset: 4550 })
})
```

## 参考答案

```js
class SizeCache {
  constructor(count, estimated) {
    this.count = count
    this.heights = new Array(count).fill(estimated)
    this.tops = new Array(count + 1).fill(0) // tops[count] 是总高度
    this.dirtyFrom = 0 // 从这一项开始位置需要重算
  }

  setHeight(index, height) {
    const diff = height - this.heights[index]
    if (diff) {
      this.heights[index] = height
      this.dirtyFrom = Math.min(this.dirtyFrom, index + 1)
    }
    return diff
  }

  // 懒更新：读取时才从最早变化的项往后重算
  ensure() {
    for (let i = Math.max(1, this.dirtyFrom); i <= this.count; i++) this.tops[i] = this.tops[i - 1] + this.heights[i - 1]
    this.dirtyFrom = this.count + 1
  }

  top(index) {
    this.ensure()
    return this.tops[index]
  }

  get totalHeight() {
    return this.top(this.count)
  }

  // 二分查找最后一个 top <= offset 的项
  findIndex(offset) {
    this.ensure()
    let lo = 0
    let hi = this.count - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.tops[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  getRange(scrollTop, viewportHeight, buffer = 5) {
    const start = Math.max(0, this.findIndex(scrollTop) - buffer)
    const end = Math.min(this.count, this.findIndex(scrollTop + viewportHeight - 1) + 1 + buffer)
    return { start, end, offset: this.top(start) }
  }
}
```
