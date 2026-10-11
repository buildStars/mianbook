---
difficulty: 2
tags: [高频, 手写题]
---

# 前端常考的算法题：列表转树、版本号比较、大数相加怎么写？

::: tip 一句话回答
**列表转树**一次遍历就能完成：用 Map 按 id 存每个节点的 children 数组，节点出现时挂到父节点的数组里，父节点出现得晚也没关系，整体 O(n)。**版本号比较**按 `.` 分段转成数字逐段比较，段数少的一方补 0。**大数相加**从个位开始逐位相加并处理进位，结果用字符串表示，不受 `Number.MAX_SAFE_INTEGER` 的限制；运行环境支持时也可以直接用 BigInt。**千分位**可以用正则，也可以用 `Intl.NumberFormat`，后者还能处理不同地区的格式。
:::

## 详细解析

### 列表转树和树转列表

菜单、部门、评论这类树形数据，后端常存成带 `id` 和 `parentId` 的扁平列表。暴力做法是对每个节点再扫一遍列表找子节点，O(n²)。**思路**：用 Map 按 id 保存"这个 id 的子节点数组"，第一次用到时创建；新建节点时直接复用这个数组，所以不管父节点先出现还是子节点先出现，最后都挂在同一个数组上。`parentId` 等于 `rootParentId` 的是根节点。树转列表用显式栈做前序遍历，层级很深也不会栈溢出。两个函数都是时间 O(n)，空间 O(n)。

```js
function listToTree(items, rootParentId = null) {
  const childrenOf = new Map() // id -> 子节点数组
  // 取 id 的子节点数组，没有就新建（Map 的 set 返回 Map 本身，可以接着 get）
  const getChildren = (id) => childrenOf.get(id) ?? childrenOf.set(id, []).get(id)
  const roots = []
  for (const item of items) {
    const node = { ...item, children: getChildren(item.id) } // 拷贝一份，不修改入参
    if (item.parentId === rootParentId) roots.push(node)
    else getChildren(item.parentId).push(node)
  }
  return roots
}

function treeToList(tree) {
  const result = []
  const stack = [...tree].reverse() // 反转后入栈，出栈顺序才和原顺序一致
  while (stack.length) {
    const { children = [], ...rest } = stack.pop()
    result.push(rest) // 去掉 children 字段
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  return result
}

const tree = listToTree([{ id: 3, parentId: 1 }, { id: 1, parentId: null }, { id: 2, parentId: null }])
console.log(JSON.stringify(tree)) // '[{"id":1,"parentId":null,"children":[{"id":3,"parentId":1,"children":[]}]},{"id":2,"parentId":null,"children":[]}]'
console.log(treeToList(tree).map((item) => item.id)) // [1, 3, 2]
```

### 版本号比较

**思路**：`'1.10'` 和 `'1.9'` 按字符串比较会得到错误结果，必须分段转数字；段数不同时缺的段当 0，所以 `'1.0'` 和 `'1.0.0'` 相等。a > b 返回 1，a < b 返回 -1，相等返回 0，和 `sort` 比较函数的约定一致，可以直接拿去排序。时间 O(n)，n 是版本号长度。

```js
function compareVersion(a, b) {
  const partsA = a.split('.')
  const partsB = b.split('.')
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const x = Number(partsA[i] ?? 0) // 缺的段补 0，'01' 转成 1
    const y = Number(partsB[i] ?? 0)
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}
console.log(compareVersion('1.10.0', '1.9'), compareVersion('1.0', '1.0.0')) // 1 0
console.log(['1.10', '1.2', '1.9.1'].sort(compareVersion)) // ['1.2', '1.9.1', '1.10']
```

### 大数相加

超过 `Number.MAX_SAFE_INTEGER`（2⁵³ - 1）的整数不一定能精确表示，`Number('9007199254740993')` 得到的是 `9007199254740992`，原因见 [0.1 + 0.2 为什么不等于 0.3](/basics/javascript/20-float-precision)。**思路**：模拟竖式加法，两个指针从末位往前走，逐位相加，进位带到下一位。时间 O(max(m, n))，空间 O(max(m, n))。

```js
function addStrings(a, b) {
  let i = a.length - 1
  let j = b.length - 1
  let carry = 0
  const digits = []
  while (i >= 0 || j >= 0 || carry > 0) {
    const sum = (i >= 0 ? Number(a[i--]) : 0) + (j >= 0 ? Number(b[j--]) : 0) + carry // 位用完了就当 0
    digits.push(sum % 10)
    carry = Math.floor(sum / 10)
  }
  return digits.reverse().join('') // 低位先放进数组，最后反转
}
console.log(addStrings('9007199254740993', '1')) // '9007199254740994'
console.log(addStrings('999', '1')) // '1000'
```

ES2020 起可以直接写 `(BigInt(a) + BigInt(b)).toString()`，最短也最可靠。取舍在于：BigInt 只能表示整数；不能和 Number 混合运算，`1n + 1` 会抛 TypeError；`JSON.stringify` 遇到 BigInt 也会抛 TypeError，和后端交互时仍要转成字符串。面试考的是手写逐位相加，可以先写手写版，再说明项目里会用 BigInt。

### 千分位格式化

**思路**：整数部分里，后面紧跟着 3 的倍数个数字的位置要插逗号，用正向先行断言找这些位置，`\B` 保证不在开头插；小数部分不参与，先拆开。时间 O(n)。

```js
function formatThousands(num) {
  const [intPart, decimalPart] = String(num).split('.')
  const formatted = intPart.replace(/\B(?=(\d{3})+$)/g, ',')
  return decimalPart === undefined ? formatted : `${formatted}.${decimalPart}`
}
console.log(formatThousands(1234567.891)) // '1,234,567.891'
console.log(formatThousands(-1234.5)) // '-1,234.5'
```

项目里更推荐 `Intl.NumberFormat`：`new Intl.NumberFormat('en-US').format(1234567.891)` 得到 `'1,234,567.891'`，换成 `'de-DE'` 则是 `'1.234.567,891'`，地区差异由浏览器处理。它默认最多保留 3 位小数并四舍五入，用 `minimumFractionDigits`、`maximumFractionDigits` 控制。`num.toLocaleString('en-US')` 效果一样，但每次调用都要重新查找地区数据，批量格式化时应该创建一个 `Intl.NumberFormat` 实例反复使用。

### 数组去重和扁平化

去重用 `[...new Set(arr)]`，它按 SameValueZero 判断相等，`NaN` 也能去重，对象按引用比较，见 [Map 和 Set](/basics/javascript/19-map-weakmap)；对象数组按字段去重，用 Map 以字段值为键，只保留第一次出现的项。扁平化可以直接用 `arr.flat(Infinity)`，手写时递归展开数组元素，用 `depth` 控制层数，把结果数组一路传下去，避免 `result.push(...flatten(item))` 在子数组很大时超出参数个数上限。两者都是 O(n)。

```js
function flatten(arr, depth = Infinity, result = []) {
  for (const item of arr) {
    if (Array.isArray(item) && depth > 0) flatten(item, depth - 1, result)
    else result.push(item)
  }
  return result
}
console.log(flatten([1, [2, [3, [4]]]], 1)) // [1, 2, [3, [4]]]
```

## 面试官可能追问

::: details 版本号带 -alpha、-beta 这类预发布标签时怎么比较？
按语义化版本的规则：先比较主版本、次版本、修订号；相同时，带预发布标签的版本更小，`1.0.0-alpha` < `1.0.0`。两个预发布标签按 `.` 分段逐段比较，纯数字的段按数值比较，含字母或连字符的段按 ASCII 顺序比较，数字段小于字母段，前面都相同时段数多的更大，如 `1.0.0-alpha` < `1.0.0-alpha.1` < `1.0.0-beta` < `1.0.0-beta.2` < `1.0.0-beta.11`。`+` 后面的构建元数据不参与比较。项目里直接用 `semver` 包的 `compare`，版本号规则见[包管理器](/basics/node/10-package-managers)。
:::

::: details 大数相乘怎么写？
结果最多 m + n 位，开一个长度 m + n 的数组。`a[i] × b[j]` 的结果落在下标 `i + j + 1` 上，十位进到 `i + j`。双重循环从低位往高位累加，处理完进位后去掉前导 0，全部是 0 时返回 `'0'`。时间 O(m × n)。
:::

::: details 列表数据不规范时，列表转树要怎么处理？
父节点不存在的项（孤儿节点）会挂在一个永远不会被访问的数组上，悄悄丢失，可以在最后检查 Map 里哪些 id 从未作为节点出现，把它们的子节点当根节点或者报错。数据有环时（A 的父是 B，B 的父是 A），环上的节点永远连不到根，同样会丢失；如果要从某个节点往上找路径（面包屑），要用 visited 防止死循环。
:::

## 易错点

- 列表转树用 `filter` 递归找子节点，看起来简洁，但复杂度是 O(n²)，数据量大时很慢
- 大数相加循环条件漏了 `carry > 0`，`'999' + '1'` 会丢掉最高位的 1
- 千分位正则没有先拆出小数部分，小数位也会被插上逗号
