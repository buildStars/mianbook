---
difficulty: 2
tags: [高频, 手写题]
---

# 二叉树的遍历有哪些方式？递归和迭代分别怎么写？

::: tip 一句话回答
深度优先有**前序**（根左右）、**中序**（左根右）、**后序**（左右根）三种，名字指的是根节点在什么时候被访问；广度优先是**层序遍历**，用队列一层一层处理。递归写法只是挪动"访问根节点"那一行的位置；迭代写法用**栈**模拟递归：前序弹出即访问，先压右再压左；中序一路向左压栈，弹出时访问再转向右子树；后序可以按"根右左"遍历再整体反转。二叉树的题大多是在遍历的基础上想清楚：**当前节点要做什么，要从子树拿到什么结果**。
:::

## 详细解析

### 节点定义和建树辅助函数

```js
class TreeNode {
  constructor(val, left = null, right = null) {
    Object.assign(this, { val, left, right })
  }
}
// 按层序数组建树，null 表示空节点，和刷题平台的格式一致，如 [3, 9, 20, null, null, 15, 7]
function buildTree(values) {
  if (values.length === 0 || values[0] === null) return null
  const root = new TreeNode(values[0])
  const queue = [root]
  for (let i = 1, head = 0; i < values.length; head++) {
    const node = queue[head] // 按层序依次给队列里的节点挂左右子节点
    for (const side of ['left', 'right']) {
      const val = values[i++] ?? null // 越界也当作空节点
      if (val !== null) queue.push((node[side] = new TreeNode(val))) // 挂上子节点，再入队等着挂它的子节点
    }
  }
  return root
}
```

### 递归写法和递归三要素

写递归先想清楚三件事：**函数的定义**（输入什么、返回什么），**终止条件**（通常是节点为空），**本层逻辑**（怎么用子树的结果算出当前结果）。三种遍历的区别只是访问根节点的时机。遍历和后面的几道例题都是每个节点访问一次，时间 O(n)；递归栈深度等于树高 h，空间 O(h)，平衡时是 O(log n)，退化成链表时是 O(n)。

```js
function traverse(root, order) {
  const result = []
  const dfs = (node) => {
    if (!node) return
    if (order === 'pre') result.push(node.val) // 根 左 右
    dfs(node.left)
    if (order === 'in') result.push(node.val) // 左 根 右
    dfs(node.right)
    if (order === 'post') result.push(node.val) // 左 右 根
  }
  dfs(root)
  return result
}
```

### 迭代写法：用栈模拟递归

**前序**：栈里先放根节点，每次弹出一个就访问，再先压右子节点、后压左子节点，这样左子节点先出栈。**后序**：把前序的压栈顺序改成先左后右，得到"根右左"的序列，最后整体反转就是"左右根"。**中序**稍复杂，因为访问根节点之前要先走完左子树：

```js
function inorderIterative(root) {
  const result = []
  const stack = []
  let node = root
  while (node || stack.length > 0) {
    for (; node; node = node.left) stack.push(node) // 一路向左，沿途节点都压栈
    node = stack.pop() // 左边走到头了，访问栈顶
    result.push(node.val)
    node = node.right // 转向右子树，重复上面的过程
  }
  return result
}
```

### 层序遍历：按层输出

用队列，每轮处理完当前层的所有节点，同时收集下一层。这里每层换一个新数组，没有用 `shift()` 出队，因为数组的 `shift` 是 O(n)，见[复杂度分析](/basics/algorithm/01-complexity)。时间 O(n)，空间 O(树的最大宽度)。

```js
function levelOrder(root) {
  const levels = []
  let current = root ? [root] : []
  while (current.length > 0) {
    levels.push(current.map((node) => node.val))
    current = current.flatMap((node) => [node.left, node.right]).filter(Boolean) // 下一层的非空节点
  }
  return levels
}
console.log(levelOrder(buildTree([3, 9, 20, null, null, 15, 7]))) // [[3], [9, 20], [15, 7]]
```

### 例：最大深度、对称二叉树、验证二叉搜索树

- **最大深度**：树的深度 = 1 + 左右子树深度的较大值，要先拿到子树的结果，是后序的思路
- **对称二叉树**：转化成"左右两棵子树是否互为镜像"：根值相等，且 a 的左和 b 的右、a 的右和 b 的左分别互为镜像
- **验证二叉搜索树**：BST 的中序遍历严格递增。中序遍历时记住上一个值，当前值不大于它就不是 BST

```js
const maxDepth = (root) => (root ? 1 + Math.max(maxDepth(root.left), maxDepth(root.right)) : 0)

function isMirror(a, b) {
  if (!a || !b) return a === b // 都为空才算对称
  return a.val === b.val && isMirror(a.left, b.right) && isMirror(a.right, b.left)
}
const isSymmetric = (root) => !root || isMirror(root.left, root.right)

function isValidBST(root) {
  let prev = -Infinity // 中序遍历中上一个访问的值
  const check = (node) => {
    if (!node) return true
    if (!check(node.left) || node.val <= prev) return false
    prev = node.val
    return check(node.right)
  }
  return check(root)
}
console.log(isValidBST(buildTree([5, 4, 6, null, null, 3, 7]))) // false：3 在 5 的右子树里
```

## 面试官可能追问

::: details 怎么找两个节点的最近公共祖先？
后序思路：函数返回"在这棵子树里找到的 p 或 q"。当前节点为空或者就是 p、q 时直接返回它；否则分别在左右子树里找，左右都找到了，说明 p、q 分居两侧，当前节点就是答案；只有一侧找到，就返回那一侧的结果。如果是二叉搜索树更简单：从根往下走，p、q 都小于当前值就往左，都大于就往右，否则当前节点就是答案。
:::

::: details 树很深时递归会有什么问题？
递归深度等于树高，退化成链表的树有上万层时就可能栈溢出，JS 引擎没有尾调用优化可以依赖。这时改用显式栈的迭代写法，栈是普通数组，放在堆内存里，不受调用栈大小的限制。
:::

::: details 前序和中序遍历结果能还原出二叉树吗？
能（要求节点值不重复）。前序的第一个是根；在中序里找到根的位置，左边是左子树、右边是右子树，由此知道左子树的节点个数，再切分前序数组，递归构造。先把中序的值和下标存进 Map，找根的位置是 O(1)，总体 O(n)。只有前序和后序时，一般不能唯一确定。
:::

## 易错点

- 验证 BST 只比较节点和它的左右子节点：`[5, 4, 6, null, null, 3, 7]` 中 3 是 6 的左子节点，局部看没问题，但它比根节点 5 小，却在 5 的右子树里
- 验证 BST 时把失败条件写成 `node.val < prev`，相等的值被当成合法，而 BST 一般要求严格递增
- 迭代中序的外层循环只写 `while (node)`，左子树走完后 node 为 null，栈里的节点还没处理循环就结束了
