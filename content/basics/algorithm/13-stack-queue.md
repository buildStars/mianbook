---
difficulty: 2
tags: [高频, 手写题]
---

# 栈和队列的典型题：有效括号、单调栈怎么用？

::: tip 一句话回答
栈**后进先出**，适合处理"最近一个还没配对的元素"，比如括号匹配、撤销操作；队列**先进先出**，适合 BFS 和按顺序处理任务。有效括号是遇到左括号入栈，遇到右括号就和栈顶配对。**单调栈**让栈内元素保持单调，新元素进来时把破坏单调性的元素弹出，被弹出的元素就找到了"右边第一个更大（或更小）的元素"，每个元素只进出栈一次，整体 O(n)。滑动窗口最大值用**单调队列**，队头始终是当前窗口的最大值。
:::

## 详细解析

### 在 JS 里怎么用栈和队列

JS 没有内置的栈和队列，用数组模拟：`push` / `pop` 都在尾部操作，是 O(1)，正好当栈用。队列如果用 `shift()` 出队，按规范要把后面的元素整体前移，大数组上反复调用会退化成 O(n²)，刷题时用一个 `head` 下标代替出队，或者自己实现链表、循环队列。事件循环里也有这两种结构：函数调用用调用栈，后调用的先返回；宏任务和微任务排在队列里，先进先出，见[事件循环](/basics/javascript/01-event-loop)。

### 例 1：有效括号

**思路**：最后出现的左括号要最先被闭合，正好是后进先出。左括号入栈；右括号出现时，栈顶必须是对应的左括号；最后栈要为空，否则有左括号没闭合。时间 O(n)，空间 O(n)。

```js
function isValid(s) {
  const pairs = new Map([[')', '('], [']', '['], ['}', '{']])
  const stack = []
  for (const ch of s) {
    if (!pairs.has(ch)) {
      stack.push(ch) // 左括号入栈
    } else if (stack.pop() !== pairs.get(ch)) {
      return false // 右括号要和栈顶配对；栈空时 pop() 返回 undefined，同样不配对
    }
  }
  return stack.length === 0
}
console.log(isValid('{[()]}'), isValid('([)]')) // true false
```

### 例 2：最小栈、用两个栈实现队列

**最小栈**要求 `getMin` 也是 O(1)。**思路**：开一个辅助栈和主栈同步进出，`minStack[i]` 记录主栈前 i+1 个元素的最小值，栈顶就是当前最小值。所有操作 O(1)，空间 O(n)。**两个栈实现队列**的思路：`inStack` 负责入队，`outStack` 负责出队。出队时 `outStack` 为空，就把 `inStack` 全部倒过去，顺序正好反转成先进先出。单次出队最坏 O(n)，但每个元素一生只会被搬一次，n 次操作总共 O(n)，**均摊 O(1)**。

```js
class MinStack {
  stack = []
  minStack = []
  push(val) {
    this.stack.push(val)
    this.minStack.push(Math.min(val, this.minStack.at(-1) ?? Infinity))
  }
  pop() {
    this.minStack.pop()
    return this.stack.pop()
  }
  top() { return this.stack.at(-1) }
  getMin() { return this.minStack.at(-1) }
}

class MyQueue {
  inStack = []
  outStack = [] // 栈顶就是队头
  push(x) { this.inStack.push(x) }
  pop() {
    this.#refill()
    return this.outStack.pop()
  }
  peek() {
    this.#refill()
    return this.outStack.at(-1)
  }
  empty() { return this.inStack.length === 0 && this.outStack.length === 0 }
  #refill() {
    if (this.outStack.length > 0) return // outStack 不空时倒进去，会打乱顺序
    while (this.inStack.length) this.outStack.push(this.inStack.pop())
  }
}
```

### 例 3：单调栈（每日温度、柱状图中最大的矩形）

**每日温度**：对每一天，求还要等几天才有更高的温度。暴力是对每天往后扫，O(n²)。**思路**：栈里存"还没等到更高温"的日子的下标，对应温度从栈底到栈顶递减。新的一天比栈顶暖和，栈顶那天就等到了答案，弹出并记录，一直弹到栈顶比今天高为止，再把今天入栈。每个下标进出栈各一次，时间 O(n)，空间 O(n)。面试时这样讲：看到"下一个更大 / 更小的元素"就想到单调栈；栈里放的是还在等答案的元素，谁来了能让它们出栈，谁就是它们的答案。

```js
function dailyTemperatures(temperatures) {
  const answer = new Array(temperatures.length).fill(0)
  const stack = [] // 存下标，对应温度单调递减
  for (let i = 0; i < temperatures.length; i++) {
    while (stack.length && temperatures[i] > temperatures[stack.at(-1)]) {
      const prev = stack.pop()
      answer[prev] = i - prev // prev 那天等到了更高温
    }
    stack.push(i)
  }
  return answer
}
console.log(dailyTemperatures([73, 74, 75, 71, 69, 72, 76, 73])) // [1, 1, 4, 2, 1, 1, 0, 0]
```

**柱状图中最大的矩形**：以每根柱子的高度作为矩形高度，向两边延伸到第一根比它矮的柱子为止，宽度就确定了。用递增栈：一根柱子被弹出时，让它出栈的下标 `i` 是右边第一根更矮的，它下面的栈顶是左边第一根更矮的（栈空了就取 -1），面积是 `高度 × (i - 左边界 - 1)`。数组末尾补一个高度 0 的哨兵，保证所有柱子最后都会出栈结算。时间 O(n)。

### 例 4：单调队列求滑动窗口最大值

**思路**：队列里存下标，对应的值从队头到队尾递减。新元素进来时，队尾比它小的元素不可能再成为最大值（它们更早离开窗口，又更小），全部弹出；队头下标滑出窗口时出队。这样队头永远是当前窗口的最大值。每个下标最多入队、出队各一次，时间 O(n)，空间 O(n)；用堆是 O(n log n)。滑动窗口的通用模板见[双指针和滑动窗口](/basics/algorithm/03-two-pointers)。

```js
function maxSlidingWindow(nums, k) {
  const deque = [] // 存下标，对应的值单调递减
  let head = 0 // 队头指针，代替 shift()
  const result = []
  for (let i = 0; i < nums.length; i++) {
    while (deque.length > head && nums[deque.at(-1)] <= nums[i]) deque.pop()
    deque.push(i)
    if (deque[head] <= i - k) head++ // 队头已经不在窗口 [i-k+1, i] 里
    if (i >= k - 1) result.push(nums[deque[head]])
  }
  return result
}
console.log(maxSlidingWindow([1, 3, -1, -3, 5, 3, 6, 7], 3)) // [3, 3, 5, 5, 6, 7]
```

## 面试官可能追问

::: details 数组是循环的，怎么求下一个更大元素？
把数组看成拼接了两遍，下标从 0 遍历到 2n - 1，取值用 `nums[i % n]`，只在第一遍（`i < n`）时把下标入栈。这样每个元素都能看到绕回来的那些元素，时间仍是 O(n)。
:::

::: details 接雨水能用单调栈做吗？
能。用递减栈，遇到比栈顶高的柱子时弹出栈顶作为"坑底"，新的栈顶是左墙，当前柱子是右墙，这一层能接的水是 `(min(左墙, 右墙) - 坑底) × 宽度`。另一种做法是对撞双指针：每个位置的水量取决于左右最高柱子中较矮的那个，哪边的最高值更小就先结算哪边，空间 O(1)。
:::

::: details 怎么用队列实现栈？
一个队列就够：每次 `push` 新元素后，把它前面的 n - 1 个元素依次出队再入队，新元素就到了队头，`pop` 直接出队。这样 `push` 是 O(n)、`pop` 是 O(1)；也可以反过来，把搬运放到 `pop` 时做。
:::

## 易错点

- 有效括号最后忘了检查栈是否为空，`'(('` 会被误判为有效
- 单调栈里存值而不是下标，需要算距离或宽度时就算不出来
- 两个栈实现队列时，`outStack` 不为空就往里倒，新元素压在旧元素上面，顺序乱掉
- 柱状图最大矩形忘了末尾的哨兵，单调递增的输入（如 `[1, 2, 3]`）一根柱子都不会出栈结算
