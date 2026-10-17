---
difficulty: 2
tags: [高频, 手写题]
---

# 贪心算法怎么用？合并区间、跳跃游戏怎么做？

::: tip 一句话回答
贪心是每一步都做**当前看起来最好的选择**，并且不回头。它成立需要两个条件：**贪心选择性质**（局部最优的选择能扩展成全局最优）和**最优子结构**。区间类题的套路是**先排序再一次扫描**：合并区间按起点排序，和结果里最后一个区间比较；无重叠区间按终点排序，每次留结束最早的。跳跃游戏维护"当前能到达的最远位置"。贪心和动态规划的区别是：DP 保留所有子问题的结果再比较，贪心只走一条路，所以贪心更快，但只有能证明正确时才能用。
:::

## 详细解析

### 什么时候能用贪心

贪心的正确性要证明，面试里常用**交换论证**：假设最优解在某一步没有选贪心的那个，把它换成贪心的选择，结果不会变差，所以总存在一个包含贪心选择的最优解。

反例最能说明问题：硬币面额 [1, 3, 4]，凑 6 元。贪心先拿最大的 4，再拿 1、1，共 3 枚；最优是 3 + 3，共 2 枚。这类题要用[动态规划](/basics/algorithm/10-dynamic-programming)。人民币面额（1、2、5、10……）贪心恰好是对的，这是面额本身的性质，不是贪心普遍成立。

### 例 1：合并区间

**思路**：按起点排序后，能重叠的区间一定相邻。依次看每个区间，起点不超过结果里最后一个区间的终点就合并（终点取较大值），否则另起一段。时间 O(n log n)，排序占大头；空间 O(n)（结果和排序副本）。

```js
function merge(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const res = []
  for (const [start, end] of sorted) {
    const last = res[res.length - 1]
    // 有重叠就延长最后一段，终点取较大值（[1,4] 和 [2,3] 合并后仍是 [1,4]）
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else res.push([start, end])
  }
  return res
}
console.log(merge([[1, 3], [2, 6], [8, 10], [15, 18]])) // [[1,6],[8,10],[15,18]]
console.log(merge([[1, 4], [4, 5]])) // [[1,5]]
```

### 例 2：无重叠区间

题目：最少移除几个区间，让剩下的互不重叠。**思路**：等价于"最多保留几个互不重叠的区间"。按**终点**排序，每次选结束最早且和已选区间不冲突的，给后面留下的空间最大。交换论证：最优解的第一个区间换成结束最早的那个，不会和后面冲突。时间 O(n log n)。

```js
function eraseOverlapIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a[1] - b[1])
  let kept = 0
  let lastEnd = -Infinity
  for (const [start, end] of sorted) {
    if (start >= lastEnd) { // 端点相接不算重叠
      kept++
      lastEnd = end
    }
  }
  return intervals.length - kept
}
console.log(eraseOverlapIntervals([[1, 2], [2, 3], [3, 4], [1, 3]])) // 1
```

按起点排序也能做，但遇到重叠时要保留终点较小的那个，逻辑更绕。会议室安排、射气球（最少箭数）都是这个模型。

### 例 3：跳跃游戏

`nums[i]` 表示从位置 i 最多能跳几步。**能否到达终点**：遍历时维护能到达的最远位置 `farthest`，如果当前位置 `i` 已经超过 `farthest`，说明到不了这里。**最少跳几次**：把每一跳能覆盖的范围看成一层，走到当前层的边界时必须再跳一次，下一层的边界是这一层里能到的最远位置，本质是按层的 BFS。两题都是 O(n) 时间、O(1) 空间。

```js
function canJump(nums) {
  let farthest = 0
  for (let i = 0; i < nums.length; i++) {
    if (i > farthest) return false // 当前位置不可达
    farthest = Math.max(farthest, i + nums[i])
  }
  return true
}

function jump(nums) {
  let steps = 0
  let curEnd = 0 // 当前这一跳能覆盖到的边界
  let farthest = 0
  // 不遍历最后一个位置：到了终点不用再跳
  for (let i = 0; i < nums.length - 1; i++) {
    farthest = Math.max(farthest, i + nums[i])
    if (i === curEnd) {
      steps++
      curEnd = farthest
    }
  }
  return steps
}
console.log(canJump([2, 3, 1, 1, 4]), canJump([3, 2, 1, 0, 4])) // true false
console.log(jump([2, 3, 1, 1, 4]), jump([0])) // 2 0
```

### 例 4：买卖股票 II

可以多次买卖，求最大利润。**思路**：任何一段上涨都可以拆成相邻两天的涨幅之和，所以把所有正的相邻差价加起来就是答案。O(n) 时间、O(1) 空间。

```js
function maxProfit(prices) {
  let profit = 0
  for (let i = 1; i < prices.length; i++) profit += Math.max(0, prices[i] - prices[i - 1])
  return profit
}
console.log(maxProfit([7, 1, 5, 3, 6, 4])) // 7
```

如果限制只能交易 k 次或有冷冻期，贪心就不成立了，要用状态机 DP。

## 面试官可能追问

::: details 贪心和动态规划怎么选？
先想能不能找到一个"每步都这么选一定不亏"的规则，并试着用交换论证证明，再找几个小反例验证。证不出来或者找到反例，就用 DP。DP 适用面更广，贪心在能用时通常更快、更省空间。
:::

::: details 插入区间怎么做？
区间已按起点有序且互不重叠，分三段扫描：终点小于新区间起点的原样放入；和新区间重叠的不断合并进新区间（起点取小、终点取大）；剩下的原样放入。O(n)，不用排序。
:::

::: details 分发糖果这类题怎么贪？
有两个方向的约束时，分两遍各满足一个：从左到右保证"比左边高的孩子糖更多"，从右到左保证"比右边高的孩子糖更多"，每个位置取两遍结果的较大值。一次扫描同时照顾两个方向很容易出错。
:::

## 易错点

- 合并区间时直接 `last[1] = end`，没有取较大值，被包含的区间会把终点缩短
- 无重叠区间按起点排序后直接贪，没有处理"保留终点小的那个"
- 跳跃游戏 II 遍历到最后一个位置，会多算一跳
- 没证明就用贪心，硬币找零这类题会给出错误答案
