---
difficulty: 1
tags: [手写题, 高频]
---

# 数组扁平化和去重有哪些写法？

::: tip 一句话回答
扁平化首选 `arr.flat(depth)`，默认只展开 1 层，`flat(Infinity)` 全部展开；手写可以用**递归**（遇到数组就继续展开，用 depth 控制层数）、**reduce + concat**，或者用**栈**迭代，避免嵌套太深时递归爆栈。去重首选 `[...new Set(arr)]`，时间 O(n)；`filter + indexOf` 是 O(n²)，还会把 NaN 全部丢掉；对象数组按某个字段去重，用 Map 记录见过的键。几种写法判断相等的规则不同：`indexOf` 用 `===`，找不到 NaN；`includes` 和 Set 用 SameValueZero，认为 NaN 等于 NaN、0 等于 -0。
:::

## 详细解析

### 扁平化：flat

```js
const nested = [1, [2, [3, [4]]], 5]
console.log(nested.flat()) // [ 1, 2, [ 3, [ 4 ] ], 5 ]，默认只展开 1 层
console.log(nested.flat(2)) // [ 1, 2, 3, [ 4 ], 5 ]
console.log(nested.flat(Infinity)) // [ 1, 2, 3, 4, 5 ]
console.log([1, , [2, , 3]].flat()) // [ 1, 2, 3 ]，展开的层级里的空位会被去掉
```

### 扁平化：手写

```js
// 递归：结果数组一路传下去，避免每层都创建新数组
function flatten(arr, depth = Infinity, result = []) {
  for (const item of arr) {
    if (Array.isArray(item) && depth > 0) flatten(item, depth - 1, result)
    else result.push(item)
  }
  return result
}

// reduce + concat：写法短，但每次 concat 都会复制一遍已经累积的数组
const flattenByReduce = (arr) =>
  arr.reduce((acc, item) => acc.concat(Array.isArray(item) ? flattenByReduce(item) : item), [])

// 栈：用循环代替递归，嵌套再深也不会爆栈
function flattenByStack(arr) {
  const stack = [...arr].reverse() // 倒序入栈，pop 出来就是原来的顺序
  const result = []
  while (stack.length > 0) {
    const item = stack.pop()
    if (Array.isArray(item)) for (let i = item.length - 1; i >= 0; i--) stack.push(item[i])
    else result.push(item)
  }
  return result
}

console.log(flatten(nested), flatten(nested, 1)) // [ 1, 2, 3, 4, 5 ] [ 1, 2, [ 3, [ 4 ] ], 5 ]
console.log(flattenByReduce(nested), flattenByStack(nested)) // 都是 [ 1, 2, 3, 4, 5 ]

let deep = [1]
for (let i = 0; i < 100000; i++) deep = [deep] // 嵌套 10 万层
console.log(flattenByStack(deep)) // [ 1 ]；flatten(deep) 会栈溢出，Node 里报 RangeError: Maximum call stack size exceeded
```

在 Node 里实测，`deep.flat(Infinity)` 同样会栈溢出。递归能承受多深没有固定的数字，取决于引擎和调用栈大小。真实数据很少嵌套这么深，但这说明了用栈改写递归的意义。栈里逐个 push 而不是 `stack.push(...item)`：展开运算符把数组变成函数参数，参数个数的上限因引擎而异，子数组有几万个以上的元素时就可能抛 RangeError。

### 去重

```js
const arr = [1, 1, '1', NaN, NaN, 0, -0, null, null, {}, {}]

console.log([...new Set(arr)]) // [ 1, '1', NaN, 0, null, {}, {} ]，两个 {} 是不同的引用，都保留
console.log(arr.filter((item, index) => arr.indexOf(item) === index)) // [ 1, '1', 0, null, {}, {} ]，NaN 全丢了

const result = []
for (const item of arr) if (!result.includes(item)) result.push(item)
console.log(result) // 和 Set 的结果一样，但是 O(n²)

// 对象数组按某个字段去重：Map 记录见过的键，只保留第一次出现的
function uniqueBy(list, getKey) {
  const seen = new Map()
  for (const item of list) {
    const key = getKey(item)
    if (!seen.has(key)) seen.set(key, item)
  }
  return [...seen.values()]
}
const users = [{ id: 1, name: 'Tom' }, { id: 2, name: 'Jerry' }, { id: 1, name: 'Tom（重复）' }]
console.log(uniqueBy(users, (u) => u.id)) // [ { id: 1, name: 'Tom' }, { id: 2, name: 'Jerry' } ]
```

常见的一行写法 `[...new Map(users.map((u) => [u.id, u])).values()]` 保留的是**最后一次**出现的对象（后面的 set 覆盖了前面的值），但它排在第一次出现的位置上。

### NaN、0 和 -0

| 写法 | 比较规则 | NaN 和 NaN | 0 和 -0 |
| --- | --- | --- | --- |
| `===`、`indexOf` | 严格相等 | 不相等：`[NaN].indexOf(NaN)` 是 -1 | 相等 |
| `includes`、Set、Map 的键 | SameValueZero | 相等：`[NaN].includes(NaN)` 是 true | 相等，Set 和 Map 会把 -0 存成 0 |
| `Object.is` | SameValue | 相等 | 不相等 |

所以 `filter + indexOf` 会把所有 NaN 都过滤掉：每个 NaN 的 `indexOf` 都是 -1，永远不等于它自己的下标。`===` 和 `Object.is` 的区别见 [== 和 === 的区别](/basics/javascript/08-equality)，Set 的更多用法见 [Map 和 Set](/basics/javascript/19-map-weakmap)。

### 复杂度

| 写法 | 时间复杂度 | 原因 |
| --- | --- | --- |
| `flat`、递归、栈 | O(n) | 每个元素访问一次，n 是所有层的元素总数 |
| reduce + concat | 最坏 O(n²) | 每次 concat 都复制已经累积的结果 |
| `new Set`、Map 按字段去重 | O(n) | 哈希表查找平均 O(1) |
| `filter + indexOf`、`includes` 循环 | O(n²) | 每个元素都要在数组里线性查找一次 |

## 面试官可能追问

::: details 对象数组怎么按内容去重，而不是按引用？
最好让调用方指定一个能代表对象的键，比如 id，用上面的 uniqueBy。没有现成的键时，可以用 `JSON.stringify(item)` 作为键，但它有局限：属性顺序不同的两个对象会被当成不同的；值为 `undefined`、函数、Symbol 的属性会被忽略；Date 变成字符串；有循环引用时直接抛错。要求严格时，用深度比较逐个判断，代价是 O(n²) 次比较。
:::

::: details `arr.toString().split(',')` 这种扁平化写法有什么问题？
`toString` 会递归地把嵌套数组拼成逗号分隔的字符串，所以看起来能扁平化，但结果全变成了字符串：数字要再 `map(Number)` 转回来；`null`、`undefined` 变成空字符串；对象变成 `'[object Object]'`；字符串本身含逗号时会被拆开。只适合纯数字数组的面试小技巧，项目里用 `flat`。
:::

::: details Set 去重会打乱顺序吗？
不会。Set 按插入顺序保存元素，重复的值插入时被忽略，所以每个值都留在它第一次出现的位置，展开后的顺序和原数组一致。Map 也一样按键的插入顺序遍历。
:::

## 易错点

- `flat()` 不传参数只展开 1 层，要全部展开得写 `flat(Infinity)`
- `filter + indexOf` 去重会丢掉所有 NaN，`includes` 和 Set 不会
- Set 对对象按引用判断，内容相同的两个对象不会被去重
- 稀疏数组的空位：`flat`、`forEach`、`reduce` 会跳过，而 `for...of`、展开运算符会把空位当成 `undefined`，所以上面的递归和栈写法会多出 `undefined`
