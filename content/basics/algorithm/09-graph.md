---
difficulty: 2
tags: [高频, 手写题]
---

# BFS 和 DFS 怎么选？岛屿数量、拓扑排序怎么做？

::: tip 一句话回答
**BFS** 用队列一层层向外扩展，第一次到达某个节点时走过的边数就是最少的，所以**无权图最短路径**用 BFS。**DFS** 用递归或栈一条路走到底，代码短，适合遍历连通分量、找路径、检测环。岛屿数量是把网格当成图：遇到没访问过的陆地就计数，再用 DFS 或 BFS 把整座岛标记掉。拓扑排序用 **Kahn 算法**：统计入度，入度为 0 的节点入队，出队时把邻居的入度减 1，最后输出的节点数少于总数就说明**有环**。
:::

## 详细解析

### 图怎么表示，BFS 和 DFS 怎么选

题目一般给边列表 `[[u, v], ...]`，先转成**邻接表**：每个节点对应一个邻居数组；网格题不用建图，每个格子的上下左右就是它的邻居。BFS 和 DFS 遍历整张图都是 O(V + E)（V 是节点数，E 是边数）。面试时这样判断：只问"能不能到、有几块"，两者都行，DFS 写起来短；出现"最少、最短、第几层"，用 BFS，因为它按距离从近到远访问节点。**visited 的标记时机**：BFS 要在**入队时**标记，出队时才标记的话，同一个节点会被多个邻居重复放进队列；DFS 在进入节点时标记。

| | BFS | DFS |
| --- | --- | --- |
| 数据结构 | 队列 | 递归调用栈或显式栈 |
| 擅长 | 无权图最短路径、最少步数、按层处理 | 连通分量、枚举路径、环检测、回溯 |

### 例 1：无权图的最短路径（BFS）

**思路**：从起点按层扩展，`dist` 记录每个节点的步数，同时充当 visited，第一次取出终点时的步数就是最短距离。时间 O(V + E)，空间 O(V + E)。

```js
// n 个节点（0 ~ n-1），edges 是无向边；返回 start 到 end 的最少边数，不可达返回 -1
function shortestPath(n, edges, start, end) {
  const graph = Array.from({ length: n }, () => [])
  for (const [u, v] of edges) {
    graph[u].push(v)
    graph[v].push(u)
  }
  const dist = new Array(n).fill(-1) // -1 表示还没访问
  dist[start] = 0
  const queue = [start]
  // 用 head 下标出队：shift() 要把后面的元素整体前移，大数组上会退化成 O(n²)
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]
    if (node === end) return dist[node]
    for (const next of graph[node]) {
      if (dist[next] !== -1) continue
      dist[next] = dist[node] + 1 // 入队时就标记
      queue.push(next)
    }
  }
  return -1
}
console.log(shortestPath(5, [[0, 1], [1, 2], [0, 3], [3, 4], [4, 2]], 0, 2)) // 2
```

### 例 2：岛屿数量（网格 DFS）

**思路**：逐格扫描，遇到 `'1'` 就计数加 1，再从这里 DFS 把相连的陆地都改成 `'0'`，相当于原地标记 visited，同一座岛不会被数两次。时间 O(m × n)；空间是递归深度，最坏 O(m × n)。会修改入参，不允许时另开 `visited` 数组。

```js
function numIslands(grid) {
  const rows = grid.length
  const cols = rows ? grid[0].length : 0
  let count = 0
  const sink = (r, c) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] !== '1') return
    grid[r][c] = '0' // 把整座岛"淹掉"
    for (const [nr, nc] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]]) sink(nr, nc)
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== '1') continue
      count++
      sink(r, c)
    }
  }
  return count
}
```

**递归太深就改迭代**：网格很大又连成一片时，递归会抛出 `RangeError: Maximum call stack size exceeded`。改用显式栈，逻辑不变；把 `pop()` 换成按下标从队头取，就是 BFS：

```js
function sinkIterative(grid, startR, startC) {
  const stack = [[startR, startC]]
  grid[startR][startC] = '0'
  while (stack.length) {
    const [r, c] = stack.pop()
    for (const [nr, nc] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]]) {
      if (grid[nr]?.[nc] !== '1') continue
      grid[nr][nc] = '0' // 入栈时标记，避免重复入栈
      stack.push([nr, nc])
    }
  }
}
```

### 例 3：拓扑排序与环检测（Kahn 算法）

**思路**：入度为 0 的节点没有前置依赖，可以先做；做完一个就把它指向的节点入度减 1，减到 0 就入队。环上的节点互相等待，入度永远减不到 0，所以输出数量少于节点数就说明有环。典型题是课程表，`[a, b]` 表示学 a 之前要先学 b，返回一个可行的学习顺序，有环时返回 null。时间 O(V + E)，空间 O(V + E)。

```js
function topoSort(numCourses, prerequisites) {
  const graph = Array.from({ length: numCourses }, () => [])
  const indegree = new Array(numCourses).fill(0)
  for (const [course, pre] of prerequisites) {
    graph[pre].push(course) // 边的方向：pre -> course
    indegree[course]++
  }
  const queue = [...indegree.keys()].filter((i) => indegree[i] === 0) // 没有前置的课先学
  const order = []
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]
    order.push(node)
    for (const next of graph[node]) if (--indegree[next] === 0) queue.push(next)
  }
  return order.length === numCourses ? order : null
}
console.log(topoSort(4, [[1, 0], [2, 0], [3, 1], [3, 2]])) // [0, 1, 2, 3]
console.log(topoSort(2, [[0, 1], [1, 0]])) // null（有环）
```

工程里"按依赖顺序执行"就是拓扑排序：`pnpm -r run build` 默认按拓扑顺序执行，被依赖的包先构建；Turborepo 按 `dependsOn` 建任务图，没有依赖关系的任务并行，见 [monorepo](/basics/build/11-monorepo)。Kahn 算法里同时待在队列中的节点互不依赖，正好对应可以并行的一批任务。npm 的 Arborist 构建依赖树时，用一个按目录深度排序的队列从浅到深处理节点，因为浅层的包放在哪里会影响深层的包怎么放，思路接近 BFS 按层扩展。

## 面试官可能追问

::: details DFS 也能做拓扑排序吗？怎么检测环？
能。每个节点有三种状态：未访问、访问中（在当前递归路径上）、已完成。DFS 时遇到"访问中"的邻居，说明绕回了当前路径，有环；一个节点的邻居都处理完后标为已完成并加入结果，最后反转结果就是拓扑序。只用 true / false 判断不了有向图的环，因为再次遇到"已完成"的节点并不代表有环。ES Module 的执行顺序也是这种深度优先后序，依赖先执行，自己后执行，见 [ES Module 和 CommonJS](/basics/javascript/17-esm-vs-cjs)。
:::

::: details 迷宫最少步数、"腐烂的橘子"这类题怎么做？
迷宫最少步数是网格上的 BFS，队列里存坐标。"腐烂的橘子"要求所有烂橘子同时向外扩散，用**多源 BFS**：一开始就把所有烂橘子放进队列，按层扩展，层数就是分钟数。边有权重时 BFS 不再成立，要用 Dijkstra，借助[堆](/basics/algorithm/06-heap-topk)每次取出当前距离最小的节点。
:::

::: details 图很大时，求两点之间的最短路径还能怎么优化？
用**双向 BFS**：从起点和终点同时按层扩展，每次扩展节点较少的一侧，两边相遇时把两段步数相加。在分支很多的图上（如"单词接龙"），两边各搜一半距离，访问的节点比单向 BFS 少很多。
:::

## 易错点

- 拓扑排序把边的方向弄反：`[a, b]` 表示 b 是 a 的前置，边是 b → a，入度加在 a 上
- 网格 DFS 要先判断越界再访问 `grid[r][c]`；大网格用递归可能栈溢出，要能改成显式栈
