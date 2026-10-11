---
difficulty: 2
tags: [原理, 手写题]
---

# 前缀树和并查集是什么？适合解决什么问题？

::: tip 一句话回答
**前缀树（Trie）** 是按字符逐层存储字符串的树，根到某个节点的路径就是一个前缀，节点上标记是否有单词在这里结束。插入和查找都是 O(L)（L 是单词长度），和词典大小无关，还天然支持前缀查询，适合**搜索联想、敏感词过滤、路由匹配**。**并查集**用一个父节点数组把元素组织成若干棵树，同一棵树就是同一个集合，支持"合并两个集合"和"查询两个元素是否在同一集合"；配合**路径压缩**和**按秩合并**，单次操作均摊接近 O(1)，适合**连通分量、朋友圈、判断加边是否成环**。
:::

## 详细解析

### 前缀树：结构和实现

插入 `app`、`apple`、`api`、`bad` 后的结构如下，公共前缀 `ap` 只存一份：

```text
root ─┬─ a ─ p ─┬─ p (end: app) ─ l ─ e (end: apple)
      │         └─ i (end: api)
      └─ b ─ a ─ d (end: bad)
```

**思路**：每个节点用 Map 存"字符 → 子节点"，`isEnd` 标记单词结尾。三个操作都是从根出发沿字符往下走：插入时缺节点就创建；`search` 要走到底并且 `isEnd` 为 true；`startsWith` 只要能走到底。`insert`、`search`、`startsWith` 的时间都是 O(L)；空间最坏是所有单词的字符总数个节点。`for...of` 按码点遍历字符串，不会把 emoji 这类占两个 UTF-16 码元的字符拆成两半。`suggest` 用于搜索联想，返回以 prefix 开头的最多 limit 个单词，耗时取决于前缀下面有多少节点；结果是 DFS 的先序顺序（同一层按子节点创建的先后），既不是字典序也不一定是插入顺序，要按热度排序可以在节点上记录权重。

```js
class Trie {
  root = { children: new Map(), isEnd: false }
  insert(word) {
    let node = this.root
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, { children: new Map(), isEnd: false })
      node = node.children.get(ch)
    }
    node.isEnd = true
  }
  // 沿 prefix 往下走，走不通返回 null
  #walk(prefix) {
    let node = this.root
    for (const ch of prefix) {
      node = node.children.get(ch)
      if (!node) return null
    }
    return node
  }
  search(word) { return this.#walk(word)?.isEnd === true }
  startsWith(prefix) { return this.#walk(prefix) !== null }
  suggest(prefix, limit = 10) {
    const result = []
    const dfs = (node, path) => {
      if (result.length >= limit) return
      if (node.isEnd) result.push(path)
      for (const [ch, child] of node.children) dfs(child, path + ch)
    }
    const start = this.#walk(prefix)
    if (start) dfs(start, prefix)
    return result
  }
}

const trie = new Trie()
for (const w of ['app', 'apple', 'api', 'bad']) trie.insert(w)
console.log(trie.search('ap'), trie.startsWith('ap')) // false true
console.log(trie.suggest('ap')) // ['app', 'apple', 'api']
```

### 前缀树的应用：联想、敏感词、路由

- **搜索联想**：走到前缀对应的节点，再 DFS 收集单词，就是上面的 `suggest`
- **敏感词过滤**：把敏感词建成 Trie，从文本的每个位置出发沿 Trie 往下匹配，记录走到的最长单词结尾，把这一段替换成 `*`。时间 O(n × L)，n 是文本长度，L 是最长敏感词的长度
- **路由匹配**：Gin 用的基数树（radix tree）是压缩过的前缀树，把只有一个孩子的链合并成一个节点，再支持 `:id`、`*path` 这类参数节点，见 [Gin 的路由和中间件](/basics/go/13-gin)

### 并查集：实现和应用

**思路**：`parent[x]` 是 x 的父节点，根节点的父节点是它自己，两个元素的根相同就在同一集合；合并时把一棵树的根挂到另一棵树的根下面，`union` 返回是否真的发生了合并。不优化的话，树可能退化成一条链，`find` 变成 O(n)。两个优化：**路径压缩**，`find` 时把沿途节点都直接挂到根上，下次一步就到；**按秩合并**，`rank` 记录树高的上界，合并时矮树挂到高树下面，树高不超过 O(log n)，所以递归写 `find` 也不会栈溢出。两者一起用，单次操作的均摊复杂度是 O(α(n))，α 是反阿克曼函数，实际数据规模下不超过 4，可以当成常数。

```js
class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i) // 初始时各自成一个集合
    this.rank = new Array(n).fill(0)
    this.count = n // 当前集合的数量
  }
  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]) // 路径压缩
    return this.parent[x]
  }
  union(a, b) {
    let rootA = this.find(a)
    let rootB = this.find(b)
    if (rootA === rootB) return false
    if (this.rank[rootA] < this.rank[rootB]) [rootA, rootB] = [rootB, rootA] // 让 rootA 是更高的树
    this.parent[rootB] = rootA
    if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA]++
    this.count--
    return true
  }
}
```

两道典型题。**省份数量（朋友圈）**：`isConnected[i][j] === 1` 表示 i 和 j 直接相连，求连通的集合数。**思路**：把每对相连的城市合并，最后的集合数就是答案，时间 O(n² × α(n))。**冗余连接**：一棵 n 个节点的树多加了一条边，找出这条边。**思路**：依次合并每条边的两端，两端已经在同一集合时，再连就成环，它就是多余的边，时间 O(n × α(n))。两题空间都是 O(n)。

```js
function findCircleNum(isConnected) {
  const uf = new UnionFind(isConnected.length)
  for (let i = 0; i < isConnected.length; i++) {
    for (let j = i + 1; j < isConnected.length; j++) if (isConnected[i][j] === 1) uf.union(i, j)
  }
  return uf.count
}

function findRedundantConnection(edges) {
  const uf = new UnionFind(edges.length + 1) // 节点编号 1 ~ n
  for (const [u, v] of edges) if (!uf.union(u, v)) return [u, v] // 两端已连通，这条边会成环
  return []
}
console.log(findCircleNum([[1, 1, 0], [1, 1, 0], [0, 0, 1]])) // 2
console.log(findRedundantConnection([[1, 2], [1, 3], [2, 3]])) // [2, 3]
```

## 面试官可能追问

::: details 前缀树和用哈希表存单词比，各有什么优劣？
哈希表查完整单词同样快，但查"以 ap 开头的所有单词"只能全部扫一遍；前缀树天然支持前缀查询，公共前缀只存一份。代价是节点多、每个节点都有一个 Map，内存开销大，所以工程里常用压缩后的基数树，字符集小时（如只有 26 个小写字母）也可以把子节点换成定长数组。
:::

::: details 敏感词很多、文本很长时，怎么过滤得更快？
用 AC 自动机：在 Trie 上给每个节点加一个失败指针，指向"当前路径的真后缀里，同时也是 Trie 中某个前缀（从根出发的路径）的最长那个"所在的节点，用 BFS 按层构建，思路和 KMP 的 next 数组一样。匹配失败时沿失败指针跳转，不用回到文本的下一个起点重来，整个文本只扫一遍。工程上还要先做归一化，如统一大小写、全角半角，跳过故意插在词中间的空格和符号。
:::

::: details 并查集和 DFS 都能求连通分量，怎么选？
图一次性给定时两者都行，DFS 更直观，见 [BFS 和 DFS](/basics/algorithm/09-graph)。边陆续加入、每加一条就要回答"现在有几个连通块"或"这两点通不通"时，用并查集，每次只要 O(α(n))，DFS 却要重新遍历。并查集不支持删边，遇到删边的题，可以离线把操作倒过来变成加边。
:::

## 易错点

- `search` 只检查能不能走到底，没有检查 `isEnd`，只插入了 `apple` 时查 `app` 也会返回 true
- 合并时写成 `parent[a] = b`，挂的不是根节点，集合关系就乱了，必须是 `parent[find(a)] = find(b)`
- 两个优化只用一个，复杂度是 O(log n) 级别；都不用，树可能退化成链，`find` 最坏 O(n)
