---
difficulty: 2
tags: [高频, 手写题]
---

# 链表常见题：反转链表、判断环、合并有序链表怎么写？

::: tip 一句话回答
链表题考的是**指针操作的顺序**，三个技巧覆盖大部分题目：**哑节点**（dummy）放在头节点前面，删除或插入头节点时不用特殊处理；**反转**时用 prev、curr 两个指针逐个掉转 next，先保存下一个节点再改指向；**快慢指针**一个每次走两步、一个走一步，相遇说明有环，还能找环入口、中点和倒数第 N 个节点。合并两个有序链表用哑节点加双指针，每次接上较小的节点。写之前先在纸上画出指针的变化，比直接写代码更不容易出错。
:::

## 详细解析

### 节点定义和测试辅助函数

```js
class ListNode {
  constructor(val, next = null) {
    this.val = val
    this.next = next
  }
}
// 数组转链表：从后往前建，每个新节点指向已经建好的部分
const fromArray = (values) => values.reduceRight((next, val) => new ListNode(val, next), null)
function toArray(head) {
  const values = []
  for (let node = head; node; node = node.next) values.push(node.val)
  return values
}
```

### 例 1：反转链表

**思路**：迭代写法从头走到尾，把每个节点的 next 改成指向前一个节点。改之前必须先保存原来的 next，否则后面的链表就丢了。时间 O(n)，空间 O(1)。递归写法先假设 `head.next` 之后的部分已经反转好，此时 `head.next` 是反转后那部分的尾节点，把 `head` 接到它后面即可。时间 O(n)，递归栈 O(n)，链表很长时有栈溢出的风险。

```js
function reverseList(head) {
  let prev = null
  let curr = head
  while (curr) {
    const next = curr.next // 先保存，改指向后就找不到了
    curr.next = prev
    prev = curr
    curr = next
  }
  return prev // curr 走到 null 时，prev 是新的头节点
}

function reverseListRecursive(head) {
  if (!head || !head.next) return head
  const newHead = reverseListRecursive(head.next) // 反转 head 之后的部分
  head.next.next = head // head.next 现在是那部分的尾节点，把 head 接上
  head.next = null
  return newHead
}
console.log(toArray(reverseList(fromArray([1, 2, 3])))) // [3, 2, 1]
```

### 例 2：判断环、找环入口和中点

**思路**：快指针每次走两步，慢指针走一步。无环时快指针先走到 null；有环时两者都会进入环，快指针每轮比慢指针多走一步，距离逐步缩小，一定会相遇。用 Set 记录访问过的节点也能做，但要 O(n) 空间，快慢指针只要 O(1)。

找入口要推导一下。设头节点到入口的距离为 a，入口到相遇点为 b，相遇点再走 c 回到入口，环长 L = b + c：

```text
head ──── a ────> 入口 ──── b ────> 相遇点 ──── c ────> 回到入口
```

相遇时慢指针走了 a + b，快指针比它多绕了 k 圈，走了 a + b + kL；快指针的路程是慢指针的两倍，所以 2(a + b) = a + b + kL，整理得 **a = (k - 1)L + c**。也就是说，一个指针从头节点出发，另一个从相遇点出发，都每次走一步，走完 a 步时，前者到达入口，后者绕了 k - 1 圈再走 c 步，也正好到达入口，两者在入口相遇。时间 O(n)，空间 O(1)。

```js
// 返回环的入口节点，没有环返回 null；只判断有没有环的话，相遇时直接返回 true
function detectCycle(head) {
  let slow = head
  let fast = head
  while (fast && fast.next) {
    [slow, fast] = [slow.next, fast.next.next]
    if (slow === fast) {
      let finder = head // 一个从头出发，一个从相遇点出发，同速前进
      while (finder !== slow) [finder, slow] = [finder.next, slow.next]
      return finder
    }
  }
  return null
}
```

找中点用同样的循环：都从头节点出发，快指针走到末尾时，慢指针在中点，节点数为偶数时得到的是后一个中点。

### 例 3：删除倒数第 N 个节点、合并两个有序链表

- **删除倒数第 N 个**：快指针先走 n 步，然后快慢一起走，快指针走到最后一个节点时，慢指针正好停在待删节点的前一个。要删的可能是头节点，从哑节点出发就不用特判。时间 O(n)，空间 O(1)
- **合并两个有序链表**：哑节点后面接结果，两个指针比较当前节点，把较小的接到结果末尾；一条链表走完后，另一条剩下的部分直接接上。不新建节点，时间 O(m + n)，空间 O(1)

```js
function removeNthFromEnd(head, n) {
  const dummy = new ListNode(0, head)
  let fast = dummy
  let slow = dummy
  for (let i = 0; i < n; i++) fast = fast.next // 快指针先走 n 步
  while (fast.next) [fast, slow] = [fast.next, slow.next]
  slow.next = slow.next.next // slow 是待删节点的前一个
  return dummy.next
}

function mergeTwoLists(l1, l2) {
  const dummy = new ListNode(0)
  let tail = dummy
  while (l1 && l2) {
    if (l1.val <= l2.val) [tail.next, l1] = [l1, l1.next]
    else [tail.next, l2] = [l2, l2.next]
    tail = tail.next
  }
  tail.next = l1 ?? l2 // 剩下的部分直接接上
  return dummy.next
}
console.log(toArray(removeNthFromEnd(fromArray([1, 2, 3, 4, 5]), 2))) // [1, 2, 3, 5]
console.log(toArray(mergeTwoLists(fromArray([1, 2, 4]), fromArray([1, 3, 4])))) // [1, 1, 2, 3, 4, 4]
```

## 面试官可能追问

::: details 怎么判断回文链表，要求 O(1) 空间？
用快慢指针找到中点，把后半段原地反转，再从两端同时往中间比较。比较完最好把后半段反转回去，恢复原链表，面试时提一句能体现对副作用的考虑。时间 O(n)，空间 O(1)。
:::

::: details 两个链表相交，怎么找交点？
两个指针分别从两个链表头出发，走到末尾后跳到另一个链表的头继续走。两者走过的总路程都是"自己独有的部分 + 对方独有的部分 + 公共部分"，所以会同时到达交点；不相交时会同时走到 null。时间 O(m + n)，空间 O(1)。
:::

::: details 怎么给链表排序？
用归并排序：快慢指针找中点，从慢指针后面断开，两半分别递归排序，再用上面的方法合并。慢指针要停在前一个中点（快指针从 `head.next` 出发）；如果停在后一个中点，只有两个节点时断开后前一半还是两个节点，会无限递归。时间 O(n log n)，算法对比见[快速排序和归并排序](/basics/algorithm/05-sorting)。
:::

## 易错点

- 改 `next` 之前没保存原来的下一个节点，后面的链表直接丢失
- 快指针的循环条件写成 `while (fast.next)`，空链表时直接报错，要写 `while (fast && fast.next)`
- 递归反转后忘了 `head.next = null`，原来的头节点和第二个节点之间形成环
