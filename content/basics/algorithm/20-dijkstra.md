---
difficulty: 3
tags: [原理, 手写题]
---

# 最短路径怎么求？Dijkstra 算法是怎么工作的？

::: tip 一句话回答
先看边有没有权重。**无权图**用 BFS，第一次到达某个点时走的就是最短路，O(V + E)。**带非负权的图**用 **Dijkstra**：维护起点到各点的当前最短距离，每次从未确定的点里取**距离最小**的一个，它的距离就此确定，再用它去**松弛**相邻的边；用**最小堆**取最小值，复杂度 O((V + E) log V)。它是贪心算法，依赖"已确定的点不会再被更短的路径更新"，**有负权边时这一点不成立**，要换 Bellman-Ford。求所有点对之间的最短路可以用 Floyd，O(V³)。
:::

## 详细解析

### 无权图：BFS 就是最短路

BFS 按层扩展，第一层是走 1 步能到的点，第二层是走 2 步能到的点，所以某个点第一次被访问时的层数就是最短步数。迷宫最少步数、单词接龙都是这个模型。边有权重时步数少不代表总权重小，BFS 就不对了。BFS 和 DFS 的基本写法见 [BFS 和 DFS](/basics/algorithm/09-graph)。

```js
function shortestPathBFS(graph, start, target) {
  const dist = new Map([[start, 0]])
  const queue = [start]
  for (let head = 0; head < queue.length; head++) { // 用下标出队，避免 shift 的 O(n)
    const u = queue[head]
    if (u === target) return dist.get(u)
    for (const v of graph[u] ?? []) {
      if (!dist.has(v)) { // 第一次到达就是最短
        dist.set(v, dist.get(u) + 1)
        queue.push(v)
      }
    }
  }
  return -1
}
const g = { A: ['B', 'C'], B: ['D'], C: ['D', 'E'], D: ['E'], E: [] }
console.log(shortestPathBFS(g, 'A', 'E')) // 2
```

### Dijkstra 的过程

1. `dist[起点] = 0`，其余为无穷大，把 `(0, 起点)` 放进最小堆
2. 弹出堆顶 `(d, u)`。如果 `d > dist[u]`，说明这是过期记录，跳过
3. 对 u 的每条边 `(u, v, w)`：如果 `dist[u] + w < dist[v]`，更新 `dist[v]` 并把 `(dist[v], v)` 入堆，这一步叫**松弛**
4. 堆空时，`dist` 就是起点到各点的最短距离

**为什么正确**：堆顶的 u 是所有未确定点里距离最小的。如果存在一条更短的路到 u，它必须经过某个未确定的点 x，而 `dist[x] >= dist[u]`，再加上非负的边权，不可能比 `dist[u]` 更短。所以 u 弹出时距离就确定了，这就是贪心选择。

### 例：网络延迟时间

题目：n 个节点编号 1 到 n，`times[i] = [u, v, w]` 表示信号从 u 传到 v 要 w 时间，从 k 发出信号，求所有节点都收到的最短时间，有节点收不到返回 -1。**思路**：以 k 为起点跑 Dijkstra，答案是所有最短距离的最大值。JS 没有内置堆，要手写一个，时间 O((V + E) log V)，空间 O(V + E)。

```js
class MinHeap {
  constructor() { this.data = [] } // 元素是 [距离, 节点]
  push(item) {
    const d = this.data
    d.push(item)
    let i = d.length - 1
    while (i > 0) { // 上浮
      const p = (i - 1) >> 1
      if (d[p][0] <= d[i][0]) break
      ;[d[p], d[i]] = [d[i], d[p]]
      i = p
    }
  }
  pop() {
    const d = this.data
    const top = d[0]
    const last = d.pop()
    if (d.length === 0) return top
    d[0] = last
    let i = 0
    while (true) { // 下沉
      const l = 2 * i + 1, r = l + 1
      let min = i
      if (l < d.length && d[l][0] < d[min][0]) min = l
      if (r < d.length && d[r][0] < d[min][0]) min = r
      if (min === i) break
      ;[d[min], d[i]] = [d[i], d[min]]
      i = min
    }
    return top
  }
}

function networkDelayTime(times, n, k) {
  const graph = Array.from({ length: n + 1 }, () => [])
  for (const [u, v, w] of times) graph[u].push([v, w])
  const dist = Array(n + 1).fill(Infinity)
  dist[k] = 0
  const heap = new MinHeap()
  heap.push([0, k])
  while (heap.data.length > 0) {
    const [d, u] = heap.pop()
    if (d > dist[u]) continue // 过期记录：u 已经用更短的距离处理过
    for (const [v, w] of graph[u]) {
      if (d + w < dist[v]) {
        dist[v] = d + w
        heap.push([dist[v], v])
      }
    }
  }
  const ans = Math.max(...dist.slice(1)) // 下标 0 不用
  return ans === Infinity ? -1 : ans
}
console.log(networkDelayTime([[2, 1, 1], [2, 3, 1], [3, 4, 1]], 4, 2), networkDelayTime([[1, 2, 1]], 2, 2)) // 2 -1
```

这里用的是"懒删除"：同一个点可能在堆里有多条记录，弹出过期的直接跳过，堆里最多 E 条记录。堆的原理见[堆和 Top K](/basics/algorithm/06-heap-topk)。节点少、边很多的稠密图，可以不用堆，每轮线性扫描找最小值，O(V²)。

### 为什么不能有负权边

图：A→B 权 2，A→C 权 3，C→B 权 -2，B→D 权 1。Dijkstra 先确定 B 的距离 2，用它算出 D 为 3；之后处理 C 时发现 A→C→B 只要 1，但 B 已经被确定。在"每个点只处理一次"的标准实现里，B 和 D 的答案（2、3）都是错的，正确值是 1、2。懒删除的写法遇到负权虽然有时能算对，但最坏情况复杂度会退化到指数级，也不能处理负环。

### 几种算法对比

| 算法 | 适用 | 复杂度 | 特点 |
| --- | --- | --- | --- |
| BFS | 无权图（或边权都相等）单源 | O(V + E) | 最简单 |
| Dijkstra | 非负权单源 | O((V + E) log V) | 贪心 + 堆 |
| Bellman-Ford | 可有负权单源 | O(VE) | 对所有边松弛 V-1 轮，第 V 轮还能松弛说明有负环 |
| Floyd | 所有点对 | O(V³) | 三重循环的 DP，枚举中转点，写法最短，适合点少的图 |

## 面试官可能追问

::: details 怎么还原出最短路径本身，而不只是长度？
松弛成功时记录 `prev[v] = u`。结束后从终点沿 `prev` 往回走到起点，再反转，就是路径。BFS 同理。
:::

::: details 边权只有 0 和 1 时有更快的办法吗？
可以用 0-1 BFS：用双端队列，走权为 0 的边把点放到队头，权为 1 的放到队尾，队列始终按距离有序，O(V + E)，不需要堆。
:::

::: details "最多经过 k 站的最便宜航班"能直接用 Dijkstra 吗？
不能直接用，因为多了站数限制，距离最短的路径可能站数超了，而站数少一点、价格贵一点的路径反而是答案。可以用 Bellman-Ford 只做 k+1 轮松弛（每轮基于上一轮的结果复制一份），或者把 (节点, 已用站数) 作为状态再跑 BFS/Dijkstra。
:::

## 易错点

- 带权图用普通 BFS，第一次到达不一定最短
- 有负权边还用 Dijkstra
