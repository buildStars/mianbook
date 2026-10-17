---
difficulty: 2
tags: [手写题, 原理]
---

# 洗牌算法和蓄水池抽样怎么写？怎么保证随机公平？

::: tip 一句话回答
洗牌用 **Fisher-Yates**：从最后一个位置往前，每次在 `[0, i]` 里随机选一个下标和 `i` 交换，O(n) 时间、原地完成，n! 种排列每种概率都是 1/n!。`arr.sort(() => Math.random() - 0.5)` **不均匀**：排序算法假设比较结果是一致的，随机比较会让某些排列出现得更多。**蓄水池抽样**用于从长度未知的数据流里等概率选 k 个：前 k 个直接放入，第 i 个（从 1 计数）以 k/i 的概率替换池中随机一个，最后每个元素被选中的概率都是 k/n。**加权随机**用前缀和加二分，O(log n) 选一次。
:::

## 详细解析

### Fisher-Yates 洗牌

```js
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    // j 在 [0, i] 里均匀取值，包含 i 自己
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
console.log(shuffle([1, 2, 3, 4, 5]))
```

**为什么公平**：第一轮从 n 个元素里等概率选一个放到最后一位，第二轮从剩下 n - 1 个里选一个放到倒数第二位……某个特定排列出现的概率是 1/n × 1/(n-1) × … × 1 = 1/n!。另一个角度：算法总共有 n × (n-1) × … × 2 = n! 种等可能的执行路径，每条路径对应一个不同的排列，恰好一一对应。

**常见写错**：把 `i + 1` 写成 `i`（j 取不到 i 自己，变成 Sattolo 算法，只会生成一个大环，元素永远不会留在原位）；或者每轮都从整个数组 `[0, n)` 里选 j，产生 nⁿ 条路径，nⁿ 一般不能被 n! 整除，不可能均匀。

### sort 随机比较为什么不均匀

```js
arr.sort(() => Math.random() - 0.5) // ❌ 不均匀
```

排序算法默认比较函数满足一致性和传递性，随机返回违反了这一点，结果完全取决于排序算法的实现。拿 V8 实测：对 `[1, 2, 3]` 洗 60 万次，`123` 和 `213` 各出现约 15 万次，其余四种各约 7.5 万次，差了一倍；10 个元素时第一位是原第一个元素的概率明显偏高。不同引擎实现不同，偏差的方向也不同，所以这种写法不能用在抽奖、发牌等需要公平的地方。

验证一个洗牌算法，最简单的办法就是跑很多次统计每种排列（或每个元素出现在每个位置）的频率，看是否接近均匀。

### 蓄水池抽样

场景：日志流、超大文件，事先不知道总数 n，也不能全读进内存，要等概率抽 k 条。

```js
function reservoirSample(stream, k) {
  const pool = []
  let i = 0 // 已读元素个数 - 1
  for (const item of stream) {
    if (i < k) {
      pool.push(item)
    } else {
      // 第 i+1 个元素以 k/(i+1) 的概率进入池子，替换随机一个
      const j = Math.floor(Math.random() * (i + 1))
      if (j < k) pool[j] = item
    }
    i++
  }
  return pool
}
console.log(reservoirSample(Array.from({ length: 100 }, (_, x) => x), 3))
```

**正确性**：对第 m 个元素（m > k），它进入池子的概率是 k/m。之后读第 m+1 个元素时，它被替换出去的概率是 (k/(m+1)) × (1/k) = 1/(m+1)，留下的概率是 m/(m+1)。一直留到第 n 个的概率是 k/m × m/(m+1) × … × (n-1)/n = k/n。前 k 个元素同理，从概率 1 开始乘，结果也是 k/n。时间 O(n)，空间 O(k)。`stream` 可以是任何可迭代对象，比如生成器或按行读文件的异步迭代器（换成 `for await`）。

### 加权随机

奖品 a、b、c 的权重是 1、3、6，希望按 10%、30%、60% 抽中。**思路**：算前缀和 `[1, 4, 10]`，在 `[0, 10)` 里取随机数 r，找第一个大于 r 的前缀和，它的下标就是结果。前缀和只算一次 O(n)，之后每次抽取二分查找 O(log n)。

```js
function createWeightedPicker(items, weights) {
  const prefix = []
  let total = 0
  for (const w of weights) {
    total += w
    prefix.push(total)
  }
  return function pick() {
    const r = Math.random() * total
    let lo = 0
    let hi = prefix.length - 1
    while (lo < hi) { // 找第一个 prefix[i] > r 的 i
      const mid = (lo + hi) >> 1
      if (prefix[mid] > r) hi = mid
      else lo = mid + 1
    }
    return items[lo]
  }
}
const pick = createWeightedPicker(['a', 'b', 'c'], [1, 3, 6])
console.log(pick())
```

条件写成严格大于，权重为 0 的项永远不会被选中。如果需要 O(1) 抽取，可以用别名法（Alias Method），预处理后每次只需一次随机加一次比较。

## 面试官可能追问

::: details Math.random 本身够随机吗？
`Math.random` 是伪随机数生成器，统计分布上足够做洗牌和抽样，但不是密码学安全的，输出可能被推测。抽奖、发牌这类有利益的场景应在服务端用 `crypto.getRandomValues` 或 Node.js 的 `crypto.randomInt` 生成随机数，并留存结果可审计。
:::

::: details 只要随机取 k 个数，需要把整个数组洗完吗？
不需要。Fisher-Yates 只做 k 轮，最后 k 个位置就是一个均匀的随机样本，O(k)。如果不能修改原数组又不想复制，可以用 Map 记录被交换过的下标，模拟一个"虚拟数组"。
:::

::: details 分布式环境下怎么做蓄水池抽样？
每个分片各自抽 k 个并记下自己处理的元素个数 nᵢ；合并时不能简单再抽一次，要按各分片的 nᵢ 加权。一种做法是给每个元素生成随机键，各分片保留键最小的 k 个，汇总后再取全局最小的 k 个，结果仍是均匀的。
:::

## 易错点

- 随机下标写成 `Math.floor(Math.random() * i)`，j 取不到 i，结果不是均匀洗牌
- 每轮都从整个数组里选交换位置，看起来随机，实际不均匀
- 用 `sort(() => Math.random() - 0.5)` 做抽奖，不同浏览器结果分布还不一样
- 蓄水池抽样中替换概率用固定值，没有随已读个数变化
