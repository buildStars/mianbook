---
difficulty: 2
tags: [高频, 手写题]
---

# 哈希表的典型应用：两数之和、字母异位词分组怎么做？

::: tip 一句话回答
哈希表用哈希函数把键映射到存储位置，**平均 O(1)** 完成查找、插入和删除。算法题里它的作用是**以空间换时间**：把"在已经看过的元素里找某个值"从 O(n) 的遍历变成 O(1) 的查表。两数之和边遍历边查 `target - 当前值` 是否出现过，O(n)；字母异位词分组用排序后的字符串或字母计数当键，把同组的词归到一起。JS 里做哈希表优先用 **Map 和 Set**，不用普通对象。
:::

## 详细解析

### 什么时候想到哈希表

哈希表用哈希函数把键换算成数组下标，直接定位存储位置，所以查找不用遍历。主流 JS 引擎的 Map、Set 都是用哈希表实现的，它们和普通对象的区别见 [Map、Set 和 WeakMap、WeakSet](/basics/javascript/19-map-weakmap)。题目里出现下面这些需求时，先想哈希表：

- 判断某个值**是否出现过**、出现在哪：`Set`，或 `Map<值, 下标>`
- **统计次数**：`Map<值, 次数>`
- **按某个特征分组**：`Map<特征, 列表>`，难点在于设计这个特征

面试时的讲法：先说暴力解和它的复杂度，指出瓶颈是"每次都要遍历查找"，再说"用哈希表把查找降到 O(1)，代价是 O(n) 的额外空间"。

### 例 1：两数之和

题目：给定数组 `nums` 和目标值 `target`，返回和为 `target` 的两个数的下标。**思路**：暴力解是两层循环，O(n²)。换个角度看，遍历到 `nums[i]` 时，要找的是前面有没有出现过 `target - nums[i]`，用 Map 记录"值 → 下标"，一次遍历就够。时间 O(n)，空间 O(n)。

```js
function twoSum(nums, target) {
  const indexOf = new Map() // 值 -> 下标
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i]
    // 先查再存：保证不会把同一个元素用两次
    if (indexOf.has(need)) return [indexOf.get(need), i]
    indexOf.set(nums[i], i)
  }
  return [] // 没有答案
}
console.log(twoSum([2, 7, 11, 15], 9)) // [0, 1]
```

### 例 2：字母异位词分组

题目：把字母相同、只是顺序不同的单词分到一组，如 `['eat', 'tea', 'tan', 'ate', 'nat', 'bat']`。**思路**：同组的单词有一个共同特征：字母排序后完全相同，或者每个字母出现的次数相同。把这个特征当 Map 的键，值是这一组单词。设 n 个单词、最长 k 个字母：排序键要对每个单词排序，时间 O(n · k log k)；计数键只需数一遍，时间 O(n · k)（每个键还要拼 26 个计数，字母表固定，算常数）。空间都是 O(n · k)。

```js
// 排序键：适用于任意字符
const sortKey = (word) => [...word].sort().join('')

// 计数键：只适用于小写英文字母
function countKey(word) {
  const counts = new Array(26).fill(0)
  for (const ch of word) counts[ch.charCodeAt(0) - 97]++
  return counts.join('#') // 必须加分隔符，否则 [1, 11] 和 [11, 1] 都会拼成 "111"
}

function groupAnagrams(words, keyOf = sortKey) {
  const groups = new Map() // 特征 -> 这一组单词
  for (const word of words) {
    const key = keyOf(word)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(word)
  }
  return [...groups.values()]
}
console.log(groupAnagrams(['eat', 'tea', 'tan', 'ate', 'nat', 'bat'], countKey)) // [['eat', 'tea', 'ate'], ['tan', 'nat'], ['bat']]
```

### 例 3：最长连续序列

题目：给定未排序的整数数组，求数字连续的最长序列的长度，要求 O(n)。如 `[100, 4, 200, 1, 3, 2]` 的答案是 4（1、2、3、4）。**思路**：先排序是 O(n log n)，不满足要求。把所有数放进 Set，只从**序列的起点**（`num - 1` 不在集合里）开始往后数。每个数最多被"判断是否起点"和"往后数"各访问一次，整体时间 O(n)，空间 O(n)。

```js
function longestConsecutive(nums) {
  const set = new Set(nums)
  let best = 0
  for (const num of set) { // 遍历 Set 而不是原数组，重复的数只处理一次
    if (set.has(num - 1)) continue // 不是起点，交给起点去数
    let length = 1
    while (set.has(num + length)) length++
    best = Math.max(best, length)
  }
  return best
}
console.log(longestConsecutive([100, 4, 200, 1, 3, 2])) // 4
```

### 为什么用 Map 而不用对象

- 对象的键会被转成字符串：数字 `1` 和字符串 `'1'` 是同一个键，对象作键全都变成 `'[object Object]'`
- 对象有原型，统计单词出现次数时，遇到 `constructor`、`__proto__` 这类词会出错；非要用对象，可以用 `Object.create(null)` 创建没有原型的对象
- Map 有 `size`，按插入顺序遍历，频繁增删的场景性能更好

```js
const freq = {}
for (const word of ['constructor', '__proto__']) freq[word] = (freq[word] || 0) + 1
console.log(freq.constructor) // 'function Object() { [native code] }1'
console.log(Object.keys(freq)) // ['constructor']：__proto__ 根本没被记进去
```

## 面试官可能追问

::: details 数组已经有序时，两数之和还有更好的做法吗？
有序时用对撞指针：左右两端各一个指针，和偏小就右移左指针，偏大就左移右指针，时间 O(n)，空间 O(1)，见[双指针和滑动窗口](/basics/algorithm/03-two-pointers)。三数之和也是先排序，再固定一个数、剩下两个用对撞指针，O(n²)。
:::

::: details 和为 K 的子数组有多少个？
用前缀和加哈希表。子数组 `[j + 1, i]` 的和等于 `prefix[i] - prefix[j]`，要它等于 k，就是找之前有多少个前缀和等于 `prefix[i] - k`。数组里有负数时窗口不具备单调性，不能用滑动窗口。时间 O(n)，空间 O(n)。

```js
function subarraySum(nums, k) {
  const prefixCount = new Map([[0, 1]]) // 前缀和 -> 出现次数；空前缀的和是 0
  let prefix = 0
  let count = 0
  for (const num of nums) {
    prefix += num
    count += prefixCount.get(prefix - k) ?? 0
    prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1)
  }
  return count
}
console.log(subarraySum([1, -1, 1, 1], 2)) // 2
```
:::

::: details 哈希冲突怎么处理？最坏复杂度是多少？
不同的键算出同一个位置就是冲突。常见解法有两种：链地址法，同一位置挂一个链表，Java 的 HashMap 链表过长还会转成红黑树，见 [HashMap](/basics/java/01-hashmap)；开放寻址，冲突了就按规则探测下一个空位，Go 从 1.24 起的 map 实现就属于这一类，见 [Go 的 map](/basics/go/04-map)。冲突严重时单次操作退化到 O(n)，所以哈希表的 O(1) 是平均意义上的。
:::

## 易错点

- 用 `if (map.get(key))` 判断键是否存在，值是下标 0 时会误判，要用 `map.has(key)`
- 两数之和先存后查，`[3, 2, 4]`、`target = 6` 时 3 会和自己配对
- 计数键直接 `counts.join('')`，不同的计数会拼出相同的字符串
- 最长连续序列不判断起点，或者遍历原数组而不是 Set，遇到大量重复的起点时退化成 O(n²)
