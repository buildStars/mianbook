---
difficulty: 2
tags: [高频, 手写题]
---

# 动态规划怎么入门？爬楼梯、最长递增子序列、背包问题怎么做？

::: tip 一句话回答
动态规划适用于同时满足**最优子结构**（大问题的最优解由子问题的最优解推出）和**重叠子问题**（同一个子问题被反复求解）的问题，做法是把子问题的答案存起来，每个只算一次。解题分四步：**定义状态**、写**转移方程**、确定**初始值**、确定**遍历顺序**。可以写成记忆化递归（自顶向下），也可以递推填表（自底向上）。爬楼梯是 `dp[i] = dp[i-1] + dp[i-2]`；最长递增子序列有 O(n²) 的 DP 和 O(n log n) 的贪心加二分；0-1 背包压成一维数组时容量要**倒序**遍历。
:::

## 详细解析

### 什么时候能用，怎么一步步想

- **重叠子问题**：直接递归求斐波那契，`f(5)` 要算 `f(4)` 和 `f(3)`，`f(4)` 又要算一遍 `f(3)`，调用次数指数增长；把结果存起来就只剩 O(n) 个子问题
- **最优子结构**：大问题的最优解里包含子问题的最优解。打家劫舍前 i 家的最优，一定由前 i-1 家或前 i-2 家的最优推出。爬楼梯这类计数题没有"最优"，对应的要求是子问题的答案能直接组合成大问题的答案
- **无后效性**：状态一旦确定，之后怎么走只和这个状态有关，和怎么到达它无关。到第 i 阶的方法数只看 i-1 和 i-2 阶的方法数，不关心之前具体怎么走的。状态定义得不满足这一点，就要往状态里加信息，比如买卖股票的题要加一维"当前是否持股"

和分治比，分治的子问题互不重叠（如归并排序的左右两半），不用存结果；和贪心比，贪心每步只取当前最优、不回头，只有能证明局部最优推出全局最优时才对。面试时按四步讲：

1. **状态定义**：用一句话说清 `dp[i]` 的含义，比如"以 `nums[i]` 结尾的最长递增子序列长度"。这一步定错了，后面都写不出来
2. **转移方程**：考虑最后一步有哪些选择，`dp[i]` 怎么由更小的状态推出
3. **初始值**：最小的子问题直接给出答案，如 `dp[0]`、`dp[1]`
4. **遍历顺序**：保证算 `dp[i]` 时，它依赖的状态都已经算好

最后补一句复杂度（状态数 × 每个状态的转移成本），再提空间优化。记忆化递归和递推的复杂度一样：记忆化更贴近"拆问题"的思路，只算用得到的状态，但递归太深会栈溢出；递推没有递归开销，也更容易压缩空间。两种写法的代码对比见[复杂度分析](/basics/algorithm/01-complexity)里斐波那契数的三种写法，爬楼梯和它只差初始值。

### 例 1：爬楼梯和打家劫舍（一维 DP）

**爬楼梯**：每次爬 1 或 2 阶，到第 n 阶有几种方法。**思路**：最后一步要么从 n-1 阶上来，要么从 n-2 阶上来，所以 `dp[i] = dp[i-1] + dp[i-2]`，只依赖前两项，用两个变量滚动。**打家劫舍**：不能偷相邻的两家，求最大金额。**思路**：第 i 家不偷，金额等于前 i-1 家的最优；偷，等于前 i-2 家的最优加上这家，`dp[i] = max(dp[i-1], dp[i-2] + nums[i])`。两题都是时间 O(n)，空间 O(1)。

```js
function climbStairs(n) {
  if (n <= 2) return n
  let prev2 = 1 // dp[1]
  let prev1 = 2 // dp[2]
  for (let i = 3; i <= n; i++) [prev2, prev1] = [prev1, prev1 + prev2]
  return prev1
}

function rob(nums) {
  let prev2 = 0 // dp[i-2]
  let prev1 = 0 // dp[i-1]
  for (const money of nums) [prev2, prev1] = [prev1, Math.max(prev1, prev2 + money)]
  return prev1
}
console.log(climbStairs(5)) // 8
console.log(rob([2, 7, 9, 3, 1])) // 12（偷 2、9、1）
```

### 例 2：最长递增子序列（LIS）

**O(n²) 的 DP**：`dp[i]` 是以 `nums[i]` 结尾的最长严格递增子序列长度。它可以接在任何比它小的 `nums[j]`（j < i）后面，所以 `dp[i] = max(dp[j] + 1)`，答案是所有 `dp[i]` 的最大值。状态定义成"以 i 结尾"，是因为接下一个数时必须知道最后一个数是多少。时间 O(n²)，空间 O(n)。

**O(n log n) 的贪心加二分**：`tails[k]` 记录长度为 k+1 的递增子序列的最小结尾值，结尾越小，后面越容易接上新数。`tails` 一定递增，所以每来一个数，二分找到第一个 ≥ 它的位置替换掉；比所有数都大就追加。时间 O(n log n)，空间 O(n)。

```js
function lengthOfLISQuadratic(nums) {
  const dp = new Array(nums.length).fill(1) // 每个数自己就是长度 1 的子序列
  let best = 0
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < i; j++) {
      if (nums[j] < nums[i]) dp[i] = Math.max(dp[i], dp[j] + 1)
    }
    best = Math.max(best, dp[i])
  }
  return best
}

function lengthOfLIS(nums) {
  const tails = []
  for (const num of nums) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      // 找第一个 >= num 的位置（lower bound）
      const mid = (lo + hi) >> 1
      if (tails[mid] < num) lo = mid + 1
      else hi = mid
    }
    tails[lo] = num // lo === tails.length 时相当于追加
  }
  return tails.length
}
console.log(lengthOfLIS([10, 9, 2, 5, 3, 7, 101, 18])) // 4（如 2、3、7、18）
```

二分的边界写法见[二分查找](/basics/algorithm/04-binary-search)。Vue 3 的 diff 处理乱序节点时就用这个方法求最长递增子序列，找出不需要移动的节点，见[虚拟 DOM 和 diff](/basics/vue/07-vdom-diff)。

### 例 3：0-1 背包和滚动数组

n 件物品，重量 `weights[i]`、价值 `values[i]`，每件最多拿一次，求容量 `capacity` 内的最大价值。**思路**：`dp[i][j]` 是前 i 件物品放进容量 j 的最大价值，不拿第 i 件是 `dp[i-1][j]`，拿是 `dp[i-1][j-w] + v`，取较大者。

每一行只依赖上一行，可以压成一维 `dp[j]`，关键是 j 要**从大到小**遍历：算 `dp[j]` 时要用上一行的 `dp[j-w]`，倒序时它还没被本行覆盖；正序的话 `dp[j-w]` 已经是本行的值，同一件物品会被拿多次，就变成了完全背包。时间 O(n × capacity)，空间从 O(n × capacity) 降到 O(capacity)。"分割等和子集""目标和"都能转化成 0-1 背包。

```js
function knapsack01(weights, values, capacity) {
  const dp = new Array(capacity + 1).fill(0) // dp[j]：容量 j 时的最大价值
  for (let i = 0; i < weights.length; i++) {
    // 倒序：保证 dp[j - weights[i]] 还是"上一件物品"时的值
    for (let j = capacity; j >= weights[i]; j--) {
      dp[j] = Math.max(dp[j], dp[j - weights[i]] + values[i])
    }
  }
  return dp[capacity]
}
console.log(knapsack01([1, 3, 4], [15, 20, 30], 4)) // 35（拿重量 1 和 3 的两件）
```

## 面试官可能追问

::: details 完全背包（每件物品可以拿无限次）怎么改？零钱兑换怎么做？
把内层循环改成从小到大：`for (let j = weights[i]; j <= capacity; j++)`，这时 `dp[j-w]` 已经包含本件物品，等于允许重复拿。零钱兑换（凑出金额的最少硬币数）就是完全背包：`dp[j] = min(dp[j], dp[j - coin] + 1)`，`dp[0] = 0`，其余初始化为 `Infinity`，最后仍是 `Infinity` 就返回 -1。
:::

::: details 怎么求出最长递增子序列本身，而不只是长度？
O(n²) 的写法额外记 `prev[i]`，表示 `dp[i]` 取最大值时接在哪个下标后面，最后从 `dp` 最大的位置沿 `prev` 往回走。贪心加二分的写法里 `tails` 不是真正的子序列，要额外记录每个数放进 `tails` 时前一个位置是谁，最后再回溯，Vue 3 的 `getSequence` 就是这样做的。
:::

::: details 二维 DP 怎么入手？比如最长公共子序列、编辑距离
两个字符串的题，状态一般定义成 `dp[i][j]`：`a` 的前 i 个字符和 `b` 的前 j 个字符的答案。最长公共子序列：`a[i-1] === b[j-1]` 时 `dp[i][j] = dp[i-1][j-1] + 1`，否则取 `dp[i-1][j]` 和 `dp[i][j-1]` 的较大者。编辑距离：字符相等时等于 `dp[i-1][j-1]`，否则取插入、删除、替换三种操作对应状态的最小值再加 1。第 0 行、第 0 列是和空串比较，要单独初始化。
:::

::: details 怎么判断一道题该用贪心还是动态规划？
先试着给贪心找反例。零钱兑换中，面值是 `[1, 3, 4]`、金额是 6 时，贪心先拿 4，得到 4 + 1 + 1 共 3 枚，最优解是 3 + 3 只要 2 枚，所以要用 DP。能证明局部最优不会影响后面的选择（如区间调度按结束时间排序），才用贪心。
:::

## 易错点

- 状态定义含糊。LIS 的 `dp[i]` 是"以 i 结尾"，答案是所有 `dp[i]` 的最大值，不是 `dp[n-1]`
- 0-1 背包压成一维后容量正序遍历，同一件物品被重复使用，变成了完全背包
- 贪心加二分得到的 `tails` 只有长度是对的，内容不一定是一个真实存在的递增子序列
