---
title: 手写数组扁平化和去重
---

## 要求

实现三个函数，都返回新数组，不修改传入的数组：

**`flatten(arr, depth = Infinity)`**：把嵌套数组展开 `depth` 层，默认全部展开，`depth` 为 0 时不展开。

- 只展开数组（用 `Array.isArray` 判断），字符串、对象、`null` 等其他值原样保留
- 不能直接用数组自带的 `flat`
- 不用考虑稀疏数组的空位

**`unique(arr)`**：去掉重复的值，每个值留在它第一次出现的位置。判断相等的规则和 `Set` 一样：

- NaN 和 NaN 算重复，0 和 -0 算重复
- 对象按引用判断，内容一样的两个不同对象不算重复

**`uniqueBy(list, getKey)`**：对每一项调用 `getKey(item)` 得到键，键相同的只保留第一次出现的那一项。键可以是任意类型，比较规则和 unique 一样（`1` 和 `'1'` 是不同的键）。

## 提示

- flatten 用递归：遍历每一项，是数组并且还能展开（剩余层数大于 0）就带着"层数减一"继续展开它，否则直接放进结果
- 结果数组可以一路传下去，每一层都往同一个数组里 push，不用每层创建新数组再合并
- 去重用 Set 或 Map 记录见过的值或键，它们的比较规则正好是题目要求的；`indexOf` 用 `===`，永远找不到 NaN
- uniqueBy 只在键第一次出现时记录，不要让后面出现的覆盖前面的

## 起始代码

```js
function flatten(arr, depth = Infinity) {
  // 返回展开 depth 层后的新数组
}

function unique(arr) {
  // 返回去重后的新数组
}

function uniqueBy(list, getKey) {
  // 按 getKey(item) 的结果去重，保留第一次出现的
}
```

## 测试

```js
// 调用 flatten 时临时禁用数组自带的 flat，确保是自己实现的展开
const flattenWithoutFlat = (...args) => {
  const flat = Array.prototype.flat
  Array.prototype.flat = () => {
    throw new Error('不能直接用数组自带的 flat，请自己实现')
  }
  try {
    return flatten(...args)
  } finally {
    Array.prototype.flat = flat
  }
}

test('flatten 默认全部展开', () => {
  expect(flattenWithoutFlat([1, [2, [3, [4]]], 5])).toEqual([1, 2, 3, 4, 5])
  expect(flattenWithoutFlat([[], [[]], 1])).toEqual([1])
  expect(flattenWithoutFlat([])).toEqual([])
})

test('flatten 用 depth 控制展开的层数', () => {
  const nested = [1, [2, [3, [4]]], 5]
  expect(flattenWithoutFlat(nested, 1)).toEqual([1, 2, [3, [4]], 5])
  expect(flattenWithoutFlat(nested, 2)).toEqual([1, 2, 3, [4], 5])
  expect(flattenWithoutFlat(nested, 0)).toEqual([1, [2, [3, [4]]], 5])
})

test('flatten 只展开数组，其他值原样保留，原数组不变', () => {
  const obj = { length: 1, 0: 'x' } // 像数组的对象也不展开
  const input = [['ab', obj], [null, [undefined, 0]]]
  const result = flattenWithoutFlat(input)
  expect(result).toEqual(['ab', obj, null, undefined, 0])
  expect(result[1]).toBe(obj)
  expect(input).toEqual([['ab', obj], [null, [undefined, 0]]])
  expect(result).not.toBe(input)
})

test('unique 去重，每个值留在第一次出现的位置', () => {
  expect(unique([3, 1, 3, 2, 1, '1', '1'])).toEqual([3, 1, 2, '1'])
  expect(unique([null, undefined, null, undefined])).toEqual([null, undefined])
  expect(unique([])).toEqual([])
  const input = [1, 1]
  unique(input)
  expect(input).toEqual([1, 1])
})

test('unique 把 NaN 和 NaN、0 和 -0 当作重复', () => {
  expect(unique([NaN, 1, NaN])).toEqual([NaN, 1])
  expect(unique([0, -0, 0])).toHaveLength(1)
})

test('unique 对对象按引用判断', () => {
  const a = { x: 1 }
  const result = unique([a, a, { x: 1 }])
  expect(result).toHaveLength(2)
  expect(result[0]).toBe(a)
  expect(result[1]).not.toBe(a)
})

test('uniqueBy 按键去重，保留第一次出现的那一项', () => {
  const users = [
    { id: 1, name: 'Tom' },
    { id: 2, name: 'Jerry' },
    { id: 1, name: 'Tom（重复）' },
    { id: 3, name: 'Spike' },
  ]
  const result = uniqueBy(users, (u) => u.id)
  expect(result.map((u) => u.name)).toEqual(['Tom', 'Jerry', 'Spike'])
  expect(result[0]).toBe(users[0])
})

test('uniqueBy 的键可以是任意类型，1 和 "1" 不是同一个键', () => {
  const items = [{ k: 1 }, { k: '1' }, { k: NaN }, { k: NaN }, { k: null }]
  expect(uniqueBy(items, (item) => item.k)).toEqual([{ k: 1 }, { k: '1' }, { k: NaN }, { k: null }])
  const owner = { name: '共享的对象' }
  const byOwner = uniqueBy([{ owner }, { owner }, { owner: { name: '另一个' } }], (item) => item.owner)
  expect(byOwner).toHaveLength(2)
})
```

## 参考答案

```js
function flatten(arr, depth = Infinity) {
  const result = []
  // 递归：结果数组一路传下去，避免每层都创建新数组
  const walk = (list, level) => {
    for (const item of list) {
      if (Array.isArray(item) && level > 0) walk(item, level - 1)
      else result.push(item)
    }
  }
  walk(arr, depth)
  return result
}

function unique(arr) {
  return [...new Set(arr)] // Set 用 SameValueZero 判断相等，NaN 也能去重
}

function uniqueBy(list, getKey) {
  const seen = new Map() // Map 的键可以是任意类型
  for (const item of list) {
    const key = getKey(item)
    if (!seen.has(key)) seen.set(key, item) // 只记第一次出现的
  }
  return [...seen.values()]
}
```
