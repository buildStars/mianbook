---
difficulty: 2
tags: [高频, 手写题]
---

# 堆是什么？怎么用堆求 Top K？

::: tip 一句话回答
堆是一棵**完全二叉树**，最小堆里每个节点都不大于它的子节点，所以堆顶就是最小值。它用**数组**存储，下标 i 的子节点是 `2i + 1` 和 `2i + 2`；插入时放到末尾再**上浮**，删除堆顶时把末尾元素移到堆顶再**下沉**，都是 O(log n)。求最大的 K 个数，维护一个**大小为 K 的最小堆**：堆顶是当前的第 K 大，新元素比堆顶大就替换掉堆顶，总共 O(n log K)，只占 O(K) 空间，适合数据量大或数据流的场景。JS 没有内置优先队列，面试时要手写。
:::

## 详细解析

### 数组表示、上浮和下沉

完全二叉树除最后一层外都是满的，最后一层从左往右排，所以按层序存进数组不会有空洞，不需要指针：

```text
数组 [1, 3, 2, 7, 4, 5]            1          下标 i 的父节点：Math.floor((i - 1) / 2)
                                 /   \        左子节点：2i + 1
                                3     2       右子节点：2i + 2
                               / \   /
                              7   4 5
```

**上浮**：新元素放到数组末尾，只要比父节点小就和父节点交换，直到不比父节点小或到达根。**下沉**：取走堆顶后，把最后一个元素放到堆顶，只要它比较小的那个子节点大，就和这个子节点交换。树高是 log n，所以插入和删除都是 O(log n)，查看堆顶是 O(1)。

### 手写一个堆

```js
class Heap {
  // compare(a, b) < 0 表示 a 应该比 b 更靠近堆顶。默认是最小堆，传 (a, b) => b - a 就是最大堆
  constructor(compare = (a, b) => a - b) {
    this.data = []
    this.compare = compare
  }
  get size() { return this.data.length }
  peek() { return this.data[0] }
  push(value) {
    this.data.push(value)
    let i = this.data.length - 1
    while (i > 0) { // 上浮：比父节点更该靠前就交换
      const parent = Math.floor((i - 1) / 2)
      if (this.compare(this.data[i], this.data[parent]) >= 0) break
      this.#swap(i, parent)
      i = parent
    }
  }
  pop() {
    if (this.data.length <= 1) return this.data.pop()
    const top = this.data[0]
    this.data[0] = this.data.pop() // 末尾元素移到堆顶，再下沉
    let i = 0
    while (true) {
      const [left, right] = [2 * i + 1, 2 * i + 2]
      let best = i // i 和两个子节点中最该在上面的那个
      if (left < this.size && this.compare(this.data[left], this.data[best]) < 0) best = left
      if (right < this.size && this.compare(this.data[right], this.data[best]) < 0) best = right
      if (best === i) break
      this.#swap(i, best)
      i = best
    }
    return top
  }
  #swap(i, j) {
    [this.data[i], this.data[j]] = [this.data[j], this.data[i]]
  }
}
```

### 例 1：最大的 K 个数

**思路**：遍历时要一直保留"目前最大的 K 个数"，并且能快速知道其中最小的那个，它是新元素要超过的门槛。所以求最大用**最小堆**：堆满 K 个后，新元素比堆顶大，就弹出堆顶、放入新元素。面试时把"为什么求最大反而用最小堆"讲出来，比直接写代码更有说服力。时间 O(n log K)，空间 O(K)。

```js
function topK(nums, k) {
  const heap = new Heap() // 最小堆，堆顶是目前的第 k 大
  for (const num of nums) {
    if (heap.size < k) heap.push(num)
    else if (k > 0 && num > heap.peek()) {
      heap.pop() // 淘汰当前的第 k 大，换成 num
      heap.push(num)
    }
  }
  return heap.data.sort((a, b) => b - a) // 堆里剩下的就是最大的 k 个，从大到小返回
}
console.log(topK([3, 2, 1, 5, 6, 4], 2)) // [6, 5]
```

### 例 2：合并 K 个有序数组

**思路**：全局最小值一定是某个数组的当前首元素，所以只需要在 K 个"当前首元素"里找最小值，这正是堆擅长的。先把每个数组的第一个元素放进最小堆，每次弹出最小的放进结果，再把它所在数组的下一个元素放进堆。设元素总数为 N，时间 O(N log K)，堆占 O(K) 空间。合并 K 个有序链表的做法完全相同，堆里放节点，弹出后把 `node.next` 放进去。

```js
function mergeKSorted(arrays) {
  const heap = new Heap((a, b) => a[0] - b[0]) // 堆里存 [值, 第几个数组, 数组内下标]
  for (let i = 0; i < arrays.length; i++) {
    if (arrays[i].length > 0) heap.push([arrays[i][0], i, 0])
  }
  const result = []
  while (heap.size > 0) {
    const [value, i, j] = heap.pop()
    result.push(value)
    if (j + 1 < arrays[i].length) heap.push([arrays[i][j + 1], i, j + 1])
  }
  return result
}
console.log(mergeKSorted([[1, 4, 5], [1, 3, 4], [2, 6]])) // [1, 1, 2, 3, 4, 4, 5, 6]
```

### 堆、排序和快速选择怎么选

| 方法 | 时间 | 额外空间 | 适合的场景 |
| --- | --- | --- | --- |
| 全部排序再取前 K 个 | O(n log n) | 取决于排序算法 | 数据不多，写起来最省事 |
| 大小为 K 的堆 | O(n log K) | O(K) | K 远小于 n、数据流、数据放不进内存 |
| 快速选择 | 平均 O(n)，最坏 O(n²) | O(1)，原地修改 | 数据都在内存且允许修改，只要第 K 个或无序的前 K 个 |

快速选择的原理见[快速排序和归并排序](/basics/algorithm/05-sorting)。JS 标准库没有优先队列，有些刷题平台会预置第三方库，但面试时通常要求自己写。前端也有堆的身影：React 的调度器（scheduler 包）用最小堆管理任务队列，按过期时间排序，每次取最早过期、也就是最紧急的任务执行，见 [Fiber 架构](/basics/react/02-fiber)。

## 面试官可能追问

::: details 数据流的中位数怎么求？
用两个堆：大顶堆 `low` 存较小的一半，小顶堆 `high` 存较大的一半，保持 `low` 的元素个数等于 `high` 或多一个。加入新数时，先放进 `low`，再把 `low` 的堆顶移到 `high`，保证 `low` 的数都不大于 `high` 的数；如果 `high` 变得比 `low` 多，再把 `high` 的堆顶移回 `low`。中位数是 `low` 的堆顶，或两个堆顶的平均值。加入 O(log n)，查询 O(1)。
:::

::: details 前 K 个高频元素怎么做？
先用 Map 统计每个元素的出现次数，再对"元素-次数"用大小为 K 的最小堆（按次数比较），O(n log K)。也可以用桶排序：次数最多是 n，建 n + 1 个桶，下标是次数，从后往前收集 K 个，O(n)。
:::

::: details 把数组建成堆，为什么是 O(n) 而不是 O(n log n)？
逐个 push 是 O(n log n)。自底向上建堆则是从最后一个非叶子节点开始，往前逐个下沉：一半的节点是叶子，不用动；越靠近根的节点越少，虽然下沉得远，但总和是 O(n)。堆排序的第一步就是这样建堆。
:::

## 易错点

- 求最大的 K 个数用了最大堆，要把所有元素都放进去，空间变成 O(n)，失去了堆的优势
- 下沉时只和左子节点比较，应该和两个子节点中更该靠前的那个交换
- `pop` 时没处理只剩一个元素的情况，把刚弹出的末尾元素又放回了堆顶
