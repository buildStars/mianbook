---
difficulty: 2
tags: [高频, 手写题]
---

# 双指针和滑动窗口怎么用？无重复字符的最长子串怎么做？

::: tip 一句话回答
双指针用两个下标协同移动，把两层循环的 O(n²) 降到 O(n)。常见三种：**对撞指针**从两端往中间走，适合有序数组和两端比较的题；**快慢指针**同向不同速，用于原地删除元素、链表找环和找中点；**滑动窗口**维护一个连续区间，右边界不断扩张，需要时收缩左边界，每个元素最多进出窗口各一次。无重复字符的最长子串就是滑动窗口：右边界加入字符，出现重复就收缩左边界直到不重复，过程中记录最大长度，时间 O(n)。
:::

## 详细解析

### 双指针为什么能降复杂度

暴力解要枚举所有 (i, j) 组合。双指针成立的前提是题目有某种**单调性**：根据当前状态，能判断出移动哪个指针不会错过答案，于是每走一步就排除一批组合，两个指针加起来最多走 n 步。面试时把"为什么可以排除"讲清楚，比代码本身更重要。

### 对撞指针：盛最多水的容器

最简单的例子是有序数组的两数之和：两数之和偏小，说明左边的数和当前最大的数相加都不够，它不可能是答案，左指针右移；偏大则右指针左移。

**例 1：盛最多水的容器。** 题目：`height[i]` 是第 i 条竖线的高度，选两条线和 x 轴组成容器，求最多能装多少水。**思路**：从最宽的两端开始，面积 = 宽度 × 较短那条线的高度。如果移动较高的一边，宽度变小，高度仍被较短边卡住，面积不可能变大；所以较短的那条线已经和所有可能的搭档比过了，可以排除，移动它。时间 O(n)，空间 O(1)。

```js
function maxArea(height) {
  let left = 0
  let right = height.length - 1
  let best = 0
  while (left < right) {
    const area = (right - left) * Math.min(height[left], height[right])
    best = Math.max(best, area)
    // 移动较短的一边：它和中间任何一条线组合都不会比现在大
    if (height[left] < height[right]) left++
    else right--
  }
  return best
}
console.log(maxArea([1, 8, 6, 2, 5, 4, 8, 3, 7])) // 49
```

### 快慢指针

两个指针同向移动，速度或移动条件不同。数组里常用于原地删除，比如删除有序数组的重复项：慢指针指向下一个写入位置，快指针往前扫描，遇到新值才写到慢指针处，O(n) 时间、O(1) 空间。链表里用来判断环、找中点、找倒数第 N 个节点，见[链表常见题](/basics/algorithm/07-linked-list)。

### 滑动窗口模板和收缩时机

```text
left = 0
for right from 0 to n - 1:
    把 s[right] 加入窗口
    while 窗口需要收缩:
        把 s[left] 移出窗口，left++
    更新答案（求最长时在这里）
```

- **求最长**：窗口**不合法**时收缩，收缩完窗口重新合法，再更新答案
- **求最短**：窗口**合法**时收缩，在收缩的循环里更新答案，每收缩一步都得到一个更短的合法窗口

虽然有两层循环，但 `left` 和 `right` 都只增不减，各自最多走 n 步，总共 O(n)。滑动窗口的前提是：窗口扩大不会让"不合法"变回"合法"（或反过来），否则收缩左边界可能错过答案。比如数组有负数时求和为 k 的子数组，就要改用前缀和加哈希表，见[哈希表的典型应用](/basics/algorithm/02-hash-table)。

### 例 2：无重复字符的最长子串

**思路**：求最长，窗口不合法（有重复字符）时收缩。右边界加入字符前，如果窗口里已有这个字符，就不断移出左边的字符，直到把之前那个移出去。时间 O(n)，空间 O(字符集大小)。

```js
function lengthOfLongestSubstring(s) {
  const window = new Set() // 当前窗口里的字符
  let left = 0
  let best = 0
  for (let right = 0; right < s.length; right++) {
    const ch = s[right]
    // 加入 ch 会重复：收缩左边界，直到之前那个 ch 被移出窗口
    while (window.has(ch)) {
      window.delete(s[left])
      left++
    }
    window.add(ch)
    best = Math.max(best, right - left + 1) // 这时窗口一定合法
  }
  return best
}
console.log(lengthOfLongestSubstring('abcabcbb')) // 3
console.log(lengthOfLongestSubstring('')) // 0
```

### 例 3：最小覆盖子串

题目：找出 s 中包含 t 全部字符（重复的也要算够数）的最短子串。**思路**：求最短，窗口合法时收缩。用 `need` 记录每个字符还差几个，`missing` 记录总共还差几个字符；`missing` 为 0 说明窗口已覆盖 t，开始收缩并更新答案，直到移出一个必需字符。时间 O(|s| + |t|)，空间 O(字符集大小)。

```js
function minWindow(s, t) {
  if (t.length === 0) return ''
  const need = new Map() // 字符 -> 还差几个，负数表示窗口里有富余
  for (const ch of t) need.set(ch, (need.get(ch) ?? 0) + 1)
  let missing = t.length
  let left = 0
  let bestStart = 0
  let bestLen = Infinity
  for (let right = 0; right < s.length; right++) {
    const ch = s[right]
    if (need.has(ch)) {
      if (need.get(ch) > 0) missing-- // 补上了一个缺的字符
      need.set(ch, need.get(ch) - 1)
    }
    while (missing === 0) {
      if (right - left + 1 < bestLen) [bestStart, bestLen] = [left, right - left + 1]
      const out = s[left++]
      if (need.has(out)) {
        need.set(out, need.get(out) + 1)
        if (need.get(out) > 0) missing++ // 移出的是必需字符，窗口不再合法
      }
    }
  }
  return bestLen === Infinity ? '' : s.slice(bestStart, bestStart + bestLen)
}
console.log(minWindow('ADOBECODEBANC', 'ABC')) // 'BANC'
console.log(minWindow('a', 'aa')) // ''
```

## 面试官可能追问

::: details 无重复字符的最长子串还能怎么优化？
用 Map 记录每个字符最后一次出现的下标。遇到重复字符时，左边界直接跳到 `last.get(ch) + 1`，不用一步步收缩。注意要写成 `left = Math.max(left, last.get(ch) + 1)`：那个字符上次出现的位置可能已经在窗口左边了，左边界不能往回退。复杂度仍是 O(n)，但每个字符只访问一次。
:::

::: details 三数之和怎么做？
先排序，固定第一个数 `nums[i]`，在它右边用对撞指针找和为 `-nums[i]` 的两个数，总共 O(n²)。去重是重点：`i` 遇到和前一个相同的值直接跳过；找到一组解后，左右指针也要跳过相同的值。
:::

::: details 字符串里有 emoji 时会出问题吗？
会。`s[i]` 和 `s.length` 按 UTF-16 码元计算，一个 emoji 通常占两个码元，会被拆成两半。需要按字符处理时先 `const chars = [...s]`，按码点拆成数组，再在数组上滑动窗口。带肤色修饰或用零宽连接符组合的 emoji 由多个码点组成，按码点拆仍会拆开，要按用户看到的字符处理，可以用 `Intl.Segmenter` 按字素拆分。
:::

## 易错点

- 求最长和求最短，更新答案的位置不同：最长在收缩之后，最短在收缩循环之内
- 收缩用 `if` 而不是 `while`，一次只移出一个元素，窗口可能仍不合法
- 盛水容器移动较高的一边，会错过答案
- 最小覆盖子串只判断"字符有没有出现"，没有按次数计数，`t = 'aa'` 时会出错
