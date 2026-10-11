---
difficulty: 2
tags: [高频, 手写题]
---

# 二分查找怎么写才不出错？左右边界怎么处理？

::: tip 一句话回答
二分的前提不只是"数组有序"，而是**二段性**：根据 mid 处的判断，能确定答案在哪一半，丢掉另一半。写不出错的关键是**先定区间的含义，再让循环条件和边界更新跟它配套**：闭区间 `[left, right]` 用 `while (left <= right)`，更新为 `mid + 1` 和 `mid - 1`；左闭右开 `[left, right)` 用 `while (left < right)`，更新为 `mid + 1` 和 `mid`。找第一个 ≥ target 的位置（lower bound）是最常用的变形，旋转数组、对答案二分都是同一个思路。
:::

## 详细解析

### 前提是二段性，讲题先讲区间含义

数组有序只是最常见的情况。只要能写出一个判断条件，让区间前一段都不满足、后一段都满足，就能二分：每次看 mid 落在哪一段，丢掉不可能有答案的一半，时间 O(log n)。旋转排序数组整体无序，但每次总有一半是有序的；对答案二分时，判断的是"答案取 x 行不行"，x 越大越容易行。

面试时先说清**区间的含义**，也就是循环不变量，比如"`[left, right]` 里是还没排除的位置"。之后每次更新都保持这个含义，循环结束时自然知道该返回什么，也就不会在 `+1`、`-1` 上犹豫。

### 两套模板：闭区间和左闭右开

```js
// 闭区间 [left, right]：找到返回下标，找不到返回 -1
function binarySearch(nums, target) {
  let left = 0
  let right = nums.length - 1
  while (left <= right) { // 区间里还有元素
    const mid = Math.floor((left + right) / 2)
    if (nums[mid] === target) return mid
    if (nums[mid] < target) left = mid + 1 // mid 已经检查过，排除
    else right = mid - 1
  }
  return -1
}

// 左闭右开 [left, right)：返回第一个 >= target 的下标（都小于 target 时返回 nums.length）
function lowerBound(nums, target) {
  let left = 0
  let right = nums.length
  while (left < right) { // left === right 时区间为空，结束
    const mid = Math.floor((left + right) / 2)
    if (nums[mid] < target) left = mid + 1 // 保持不变量：left 左边的都 < target
    else right = mid // right 及右边的都 >= target；mid 可能就是答案，不能跳过
  }
  return left
}
console.log(lowerBound([1, 2, 2, 2, 3], 2)) // 1
```

lower bound 的几个变形：把 `nums[mid] < target` 改成 `<=`，得到第一个 > target 的位置（upper bound）；target 出现的次数是 upper bound 减 lower bound；最后一个 ≤ target 的位置是 upper bound 减 1。

### 例：搜索旋转排序数组

题目：升序数组在某处旋转过（如 `[4, 5, 6, 7, 0, 1, 2]`），元素互不相同，求 target 的下标。**思路**：mid 把区间分成两半，至少有一半是有序的。比较 `nums[left]` 和 `nums[mid]` 判断哪一半有序，再看 target 是否落在有序那一半的范围内，在就去那一半，不在就去另一半。时间 O(log n)，空间 O(1)。

```js
function searchRotated(nums, target) {
  let left = 0
  let right = nums.length - 1
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    if (nums[mid] === target) return mid
    if (nums[left] <= nums[mid]) { // 左半 [left, mid] 有序；用 <= 是因为 left 可能等于 mid
      if (nums[left] <= target && target < nums[mid]) right = mid - 1
      else left = mid + 1
    } else { // 右半 [mid, right] 有序
      if (nums[mid] < target && target <= nums[right]) left = mid + 1
      else right = mid - 1
    }
  }
  return -1
}
console.log(searchRotated([4, 5, 6, 7, 0, 1, 2], 0)) // 4
```

### 例：对答案二分，分割数组的最大值

题目：把数组分成 k 个非空的连续子数组，使各段和的最大值最小，求这个最小值。**思路**：正面求很难，反过来问"每段和不超过 limit，最少要分几段"却很好算：贪心地往当前段里加数，超了就开新段。limit 越大段数越少，有二段性；段数少于 k 时再拆开也不会让最大值变大（题目保证 k 不超过数组长度），所以找第一个"段数 ≤ k"的 limit 即可。答案范围是 [最大元素, 总和]，时间 O(n log S)，S 是数组总和，空间 O(1)。

```js
function splitArray(nums, k) {
  const piecesNeeded = (limit) => { // 每段和不超过 limit 时最少分几段，要求 limit >= 最大元素
    let pieces = 1
    let sum = 0
    for (const num of nums) {
      if (sum + num > limit) [pieces, sum] = [pieces + 1, 0] // 开一个新段
      sum += num
    }
    return pieces
  }
  let left = nums.reduce((a, b) => Math.max(a, b)) // 下界：最大的元素要能单独成段
  let right = nums.reduce((a, b) => a + b) // 上界：整个数组一段
  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    if (piecesNeeded(mid) <= k) right = mid // mid 可行，答案是 mid 或更小
    else left = mid + 1
  }
  return left
}
console.log(splitArray([7, 2, 5, 10, 8], 2)) // 18
```

### mid 会溢出吗？为什么会死循环？

- **溢出**：JS 的数字是双精度浮点数，`left + right` 在 2⁵³ - 1 以内都是精确整数，不会像 Java 的 int 那样溢出。坑在位运算：`(left + right) >> 1` 会先转成 32 位有符号整数，和超过 2³¹ - 1 就变成负数，比如 `(2e9 + 2e9) >> 1` 的结果是 -147483648。数组下标一般碰不到，但对答案二分时范围常到 10⁹，两数相加就超了。用 `Math.floor((left + right) / 2)` 最稳妥
- **死循环**：最常见的是 `left = mid` 搭配向下取整，区间只剩两个元素时 mid 等于 left，区间不再缩小。用了 `left = mid` 就要向上取整。另一种是区间含义和循环条件不配套，比如左闭右开却写 `while (left <= right)`，`left === right` 时 `right = mid` 原地不动

## 面试官可能追问

::: details 求平方根的整数部分，怎么用二分？
找最后一个满足 `x * x <= n` 的 x。答案可能就是 mid，所以写 `left = mid`，这时必须向上取整，否则会死循环。时间 O(log n)。

```js
function mySqrt(n) {
  let left = 0
  let right = n
  while (left < right) {
    const mid = Math.ceil((left + right) / 2) // 搭配 left = mid，必须向上取整
    if (mid * mid <= n) left = mid
    else right = mid - 1
  }
  return left
}
console.log(mySqrt(8)) // 2
```
:::

::: details 旋转数组有重复元素怎么办？
`nums[left]`、`nums[mid]`、`nums[right]` 可能都相等，这时判断不出哪一半有序，只能 `left++`、`right--` 各缩一步再继续，最坏情况（比如几乎全是相同的数）退化到 O(n)。
:::

::: details 怎么找旋转数组的最小值？
元素互不相同时，比较 `nums[mid]` 和 `nums[right]`：前者更大，说明最小值在 mid 右边，`left = mid + 1`；否则最小值在 `[left, mid]`，`right = mid`。
:::

## 易错点

- 区间含义、循环条件、更新方式三者不配套，是写错二分的根源
- lower bound 的返回值可能等于 `nums.length`，使用前要判断越界、判断是否真的等于 target
- 对答案二分时，判断函数假设了单个元素不超过 limit，下界就必须从最大元素开始，取 0 会得到错误答案
