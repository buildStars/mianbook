---
difficulty: 2
tags: [高频, 手写题]
---

# 回溯算法怎么写？全排列、子集、组合总和怎么做？

::: tip 一句话回答
回溯就是在**决策树**上做 DFS：每一层做一个选择，递归进入下一层，返回后**撤销这个选择**，再试下一个，走到满足条件的节点时收集结果。模板是"做选择 → 递归 → 撤销选择"。**全排列**用 `used` 数组记录哪些数已经用过；**子集和组合**用 `start` 下标保证只往后选，避免 `[1, 2]` 和 `[2, 1]` 重复。**组合总和**先排序，和超过目标就提前结束（剪枝）；有重复元素时，同一层跳过和前一个相同的值。回溯要枚举所有方案，复杂度是指数级的。
:::

## 详细解析

### 回溯和 DFS 的关系

回溯是 DFS 的一种用法。普通 DFS 遍历一张已经存在的图，回溯遍历的是"选择过程"构成的树：根节点是空方案，每条边是一次选择，叶子是一个完整方案。所有分支共用同一个 `path` 数组，从子节点返回时必须把状态恢复原样，这就是"回溯"的含义。

```text
function backtrack(路径, 选择列表):
    if 满足结束条件: 结果.push(路径的拷贝); return
    for 选择 of 选择列表:
        if 不合法或可以剪枝: continue / break
        做选择（path.push、标记 used）
        backtrack(路径, 新的选择列表)
        撤销选择（path.pop、取消标记）
```

面试时先画出决策树的前两层，说清三件事：每层在选什么、什么时候收集结果、哪些分支可以剪掉。说清了，代码基本就是套模板。

### 例 1：全排列

**思路**：每一层从所有数里选一个还没用过的放到当前位置，`used[i]` 标记第 i 个数是否已在路径中，路径长度等于 n 时收集。共 n! 个排列，每个拷贝一次花 O(n)，时间 O(n × n!)；不算结果，空间 O(n)。

```js
function permute(nums) {
  const result = []
  const path = []
  const used = new Array(nums.length).fill(false)
  const backtrack = () => {
    if (path.length === nums.length) {
      result.push([...path]) // 必须拷贝，path 之后还会被修改
      return
    }
    for (let i = 0; i < nums.length; i++) {
      if (used[i]) continue
      used[i] = true // 做选择
      path.push(nums[i])
      backtrack()
      path.pop() // 撤销选择
      used[i] = false
    }
  }
  backtrack()
  return result
}
console.log(permute([1, 2, 3])) // [[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]]
```

### 例 2：子集

**思路**：子集不关心顺序，规定只能选比上一个下标更大的元素，用 `start` 控制。决策树上**每个节点**都是一个子集，所以一进入函数就收集，不用等到叶子。共 2ⁿ 个子集，时间 O(n × 2ⁿ)，空间 O(n)。

```js
function subsets(nums) {
  const result = []
  const path = []
  const backtrack = (start) => {
    result.push([...path]) // 每个节点都是一个合法子集
    for (let i = start; i < nums.length; i++) {
      path.push(nums[i])
      backtrack(i + 1) // 下一层只能选 i 之后的元素
      path.pop()
    }
  }
  backtrack(0)
  return result
}
console.log(subsets([1, 2, 3])) // [[],[1],[1,2],[1,2,3],[1,3],[2],[2,3],[3]]
```

### 例 3：组合总和（剪枝和去重）

**组合总和**：`candidates` 无重复，每个数可以重复选，求所有和为 `target` 的组合。**思路**：和子集一样用 `start`，但递归时传 `i` 而不是 `i + 1`，表示当前数还能再选；先排序，加上当前数就超过目标时，后面更大的数也不用试了，直接 `break`。

**组合总和 II**：`candidates` 有重复，每个数只能用一次，结果不能有重复组合。**思路**：排序后相同的数挨在一起，**同一层**只让第一个相同值往下走，后面的跳过；不同层可以选相同的值，所以条件是 `i > start` 而不是 `i > 0`。

```js
// allowReuse 为 true 是组合总和（可重复选），为 false 是组合总和 II（每个数用一次）
function combinationSum(candidates, target, allowReuse = true) {
  const sorted = [...candidates].sort((a, b) => a - b)
  const result = []
  const path = []
  const backtrack = (start, remain) => {
    if (remain === 0) {
      result.push([...path])
      return
    }
    for (let i = start; i < sorted.length; i++) {
      if (sorted[i] > remain) break // 剪枝：已排序，后面的数只会更大
      if (!allowReuse && i > start && sorted[i] === sorted[i - 1]) continue // 同层去重
      path.push(sorted[i])
      backtrack(allowReuse ? i : i + 1, remain - sorted[i])
      path.pop()
    }
  }
  backtrack(0, target)
  return result
}
console.log(combinationSum([2, 3, 6, 7], 7)) // [[2,2,3],[7]]
console.log(combinationSum([10, 1, 2, 7, 6, 1, 5], 8, false)) // [[1,1,6],[1,2,5],[1,7],[2,6]]
```

组合总和的复杂度没有简单的封闭式，上界是指数级，剪枝能大幅减少实际搜索的节点；空间是递归深度。N 皇后也是同一个模板：逐行放皇后，每行选一列，用三个 Set 记录已占用的列、主对角线（`row - col` 相同）和副对角线（`row + col` 相同），冲突就跳过。

## 面试官可能追问

::: details 全排列 II（数组有重复数字）怎么去重？
先排序，再加一条判断：`if (i > 0 && nums[i] === nums[i - 1] && !used[i - 1]) continue`。`used[i - 1]` 为 false，说明前一个相同的数在这一层刚被撤销，当前位置已经用它试过了，再用 `nums[i]` 会得到重复的排列；为 true 说明它在上层的路径中，这次是在为下一个位置选值，可以继续。
:::

::: details 子集能不用递归来写吗？
可以用位运算枚举：0 到 2ⁿ - 1 的每个整数 `mask` 对应一个子集，第 i 位是 1 就选 `nums[i]`，复杂度同样是 O(n × 2ⁿ)。

```js
// mask 从 0 到 2ⁿ - 1，第 i 位为 1 就选 nums[i]
const subsetsByMask = (nums) => Array.from({ length: 1 << nums.length }, (_, mask) => nums.filter((_, i) => (mask >> i) & 1))
```
:::

::: details 什么时候用回溯，什么时候用动态规划？
要**列出所有方案**时用回溯，方案本身就是指数级的，没法更快。只要**方案数或最优值**时先考虑 DP，比如组合总和只问"有多少种组合"，就是完全背包计数，复杂度 O(n × target)，见[动态规划](/basics/algorithm/10-dynamic-programming)。
:::

## 易错点

- 收集结果时写成 `result.push(path)`，存进去的都是同一个数组的引用，回溯结束后全是空数组
- 只做选择不撤销：漏了 `path.pop()` 或 `used[i] = false`，后面的分支状态全错
- 组合用 `start`，排列用 `used`，混用会得到重复组合或漏掉排列
- 组合总和 II 的去重条件写成 `i > 0`，会把 `[1, 1, 6]` 这种在不同层用到相同值的合法结果也去掉
