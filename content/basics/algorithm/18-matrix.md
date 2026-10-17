---
difficulty: 2
tags: [手写题]
---

# 矩阵类题怎么做？螺旋矩阵、旋转图像、搜索二维矩阵怎么写？

::: tip 一句话回答
矩阵题考的主要是**下标和边界的控制**。螺旋矩阵用上下左右四个边界，每走完一条边就**收缩对应的边界**，并在走下边和左边前检查边界是否已经交错。旋转图像顺时针 90 度等于**先转置再把每行翻转**，原地 O(1) 空间。行列都有序的矩阵从**右上角**开始搜：比目标大就左移，比目标小就下移，每步排除一行或一列，O(m + n)。矩阵置零可以借**第一行和第一列当标记**，把额外空间降到 O(1)。
:::

## 详细解析

### 例 1：螺旋矩阵

**思路**：维护 `top`、`bottom`、`left`、`right` 四个边界，按"上边从左到右 → 右边从上到下 → 下边从右到左 → 左边从下到上"转圈，每走完一条边收缩一个边界。走下边前要确认 `top <= bottom`，走左边前要确认 `left <= right`，否则单行或单列的矩阵会被重复读取。时间 O(mn)，除结果外空间 O(1)。

```js
function spiralOrder(matrix) {
  const res = []
  if (matrix.length === 0) return res
  let top = 0, bottom = matrix.length - 1
  let left = 0, right = matrix[0].length - 1
  while (top <= bottom && left <= right) {
    for (let j = left; j <= right; j++) res.push(matrix[top][j])
    top++
    for (let i = top; i <= bottom; i++) res.push(matrix[i][right])
    right--
    // 只剩一行或一列时，下边和左边已经被走过了
    if (top <= bottom) {
      for (let j = right; j >= left; j--) res.push(matrix[bottom][j])
      bottom--
    }
    if (left <= right) {
      for (let i = bottom; i >= top; i--) res.push(matrix[i][left])
      left++
    }
  }
  return res
}
console.log(spiralOrder([[1, 2, 3], [4, 5, 6], [7, 8, 9]])) // [1,2,3,6,9,8,7,4,5]
console.log(spiralOrder([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]])) // [1,2,3,4,8,12,11,10,9,5,6,7]
```

### 例 2：旋转图像

题目：n × n 矩阵原地顺时针旋转 90 度。**思路**：旋转后原来的 `(i, j)` 跑到 `(j, n - 1 - i)`。转置把 `(i, j)` 变成 `(j, i)`，再水平翻转把列 `i` 变成 `n - 1 - i`，两步合起来正好是旋转。时间 O(n²)，空间 O(1)。

```js
function rotate(matrix) {
  const n = matrix.length
  // 转置：只交换对角线上方的元素，否则会换回去
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      ;[matrix[i][j], matrix[j][i]] = [matrix[j][i], matrix[i][j]]
    }
  }
  for (const row of matrix) row.reverse() // 每行左右翻转
}
const m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
rotate(m)
console.log(m) // [[7,4,1],[8,5,2],[9,6,3]]
```

逆时针 90 度：先转置再上下翻转。旋转 180 度：上下翻转再左右翻转。

### 例 3：搜索二维矩阵

题目：每行从左到右递增，每列从上到下递增，判断 target 是否存在。**思路**：右上角的元素是所在行的最大值、所在列的最小值。它比 target 大，这一列下面只会更大，整列排除，左移；比 target 小，这一行左边只会更小，整行排除，下移。时间 O(m + n)，空间 O(1)。左下角出发同理，左上角和右下角不行，因为两个方向都变大或都变小，无法排除。

```js
function searchMatrix(matrix, target) {
  if (matrix.length === 0) return false
  let i = 0
  let j = matrix[0].length - 1
  while (i < matrix.length && j >= 0) {
    const v = matrix[i][j]
    if (v === target) return true
    if (v > target) j-- // 这一列都比 target 大
    else i++ // 这一行都比 target 小
  }
  return false
}
const sorted = [[1, 4, 7, 11], [2, 5, 8, 12], [3, 6, 9, 16], [10, 13, 14, 17]]
console.log(searchMatrix(sorted, 5), searchMatrix(sorted, 15)) // true false
```

如果矩阵满足"每行的第一个数大于上一行的最后一个数"，整个矩阵展开就是一个有序数组，可以直接二分，下标 `k` 对应 `matrix[Math.floor(k / n)][k % n]`，O(log(mn))，见[二分查找](/basics/algorithm/04-binary-search)。

### 例 4：矩阵置零

题目：某个元素为 0，就把它所在的行和列都置 0，要求原地。**思路**：直观做法用两个数组记录哪些行、哪些列要清零，空间 O(m + n)。优化：用第一行和第一列充当这两个数组，但它们自己是否含 0 要提前用两个变量记下，最后再处理。时间 O(mn)，空间 O(1)。

```js
function setZeroes(matrix) {
  const m = matrix.length, n = matrix[0].length
  const firstRowZero = matrix[0].includes(0)
  const firstColZero = matrix.some((row) => row[0] === 0)
  // 用第一行、第一列记录标记
  for (let i = 1; i < m; i++) {
    for (let j = 1; j < n; j++) {
      if (matrix[i][j] === 0) matrix[i][0] = matrix[0][j] = 0
    }
  }
  for (let i = 1; i < m; i++) {
    for (let j = 1; j < n; j++) {
      if (matrix[i][0] === 0 || matrix[0][j] === 0) matrix[i][j] = 0
    }
  }
  // 最后处理第一行、第一列，否则标记会被提前覆盖
  if (firstRowZero) matrix[0].fill(0)
  if (firstColZero) for (let i = 0; i < m; i++) matrix[i][0] = 0
}
const z = [[0, 1, 2, 0], [3, 4, 5, 2], [1, 3, 1, 5]]
setZeroes(z)
console.log(z) // [[0,0,0,0],[0,4,5,0],[0,3,1,0]]
```

## 面试官可能追问

::: details 旋转图像还有别的原地写法吗？
可以一圈一圈地转，每次把四个对应位置的元素循环交换：`(i, j) → (j, n-1-i) → (n-1-i, n-1-j) → (n-1-j, i)`。外层枚举圈数 `i < n / 2`，内层枚举这一圈的位置。复杂度相同，但下标更容易写错，转置加翻转更好记也更好讲。
:::

::: details 矩阵不是方阵，能原地旋转吗？
不能简单原地做，旋转后形状从 m × n 变成 n × m。一般新建一个 n × m 的矩阵，`res[j][m - 1 - i] = matrix[i][j]`。
:::

::: details 前端里哪里会用到这些？
图片处理时像素数据就是一维化的矩阵，旋转、翻转都是下标变换；`canvas` 的 `ImageData` 里第 `(x, y)` 个像素的起始下标是 `(y * width + x) * 4`。表格组件的行列转置也是同样的思路。网格上的连通性问题（岛屿数量）则是图搜索，见 [BFS 和 DFS](/basics/algorithm/09-graph)。
:::

## 易错点

- 螺旋矩阵走下边和左边前不检查边界，单行、单列的矩阵会输出重复元素
- 转置时内层循环从 0 开始，每对元素交换两次等于没换
- 从左上角开始搜索有序矩阵，两个方向都变大，无法排除任何一行或一列
- 矩阵置零时先改第一行、第一列，导致标记丢失，整张表被清零
