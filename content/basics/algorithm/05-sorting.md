---
difficulty: 2
tags: [高频, 手写题, 对比]
---

# 快速排序和归并排序怎么实现？各自有什么特点？

::: tip 一句话回答
两者都是分治，平均 O(n log n)。**快排**先分区再递归：选一个基准，小的放左边、大的放右边，原地排序、常数小，但**不稳定**，基准选得差会退化到 O(n²)，所以要**随机选基准**。**归并**先递归再合并：拆成两半各自排好，再合并两个有序数组，任何情况都是 O(n log n) 且**稳定**，代价是 O(n) 的额外空间。JS 的 `Array.prototype.sort` 从 ES2019 起规范要求稳定，但默认**按字符串比较**，排数字一定要传比较函数。
:::

## 详细解析

### 快速排序：先分区，再递归

**思路**：选一个基准，把区间分成"小于基准"和"大于等于基准"两部分，基准放到两者之间，它的最终位置就确定了，再分别递归处理左右两部分。分区用 Lomuto 写法：`i` 指向"小于基准区"的下一个位置，`j` 往后扫描，遇到小于基准的元素就换到 `i` 处。手写时先讲清不变量"`[lo, i)` 都小于基准"，`i`、`j` 的边界就不容易写错。

为什么要随机选基准：如果固定选最后一个元素，遇到已经有序的数组，每次分区都是 0 和 n-1 两部分，递推式变成 T(n) = T(n-1) + O(n)，即 O(n²)。随机选基准后，对任何输入的期望复杂度都是 O(n log n)。

```js
function swap(arr, i, j) {
  [arr[i], arr[j]] = [arr[j], arr[i]]
}

function partition(nums, lo, hi) {
  swap(nums, lo + Math.floor(Math.random() * (hi - lo + 1)), hi) // 随机选基准，换到末尾
  const pivot = nums[hi]
  let i = lo // [lo, i) 里都小于 pivot
  for (let j = lo; j < hi; j++) {
    if (nums[j] < pivot) swap(nums, i++, j)
  }
  swap(nums, i, hi) // 基准放到最终位置
  return i
}

function quickSort(nums, lo = 0, hi = nums.length - 1) {
  if (lo >= hi) return nums
  const p = partition(nums, lo, hi)
  quickSort(nums, lo, p - 1)
  quickSort(nums, p + 1, hi)
  return nums
}
console.log(quickSort([3, 1, 2, 3, 0])) // [0, 1, 2, 3, 3]
```

时间平均 O(n log n)，最坏 O(n²)；空间是递归栈，平均 O(log n)，最坏 O(n)，只递归较短的一边、较长的一边改成循环，栈深度最坏也只有 O(log n)。分区时的远距离交换会打乱相等元素的相对顺序，所以不稳定。

### 归并排序：先递归，再合并

**思路**：一直对半拆，拆到只剩一个元素（天然有序），再两两合并。合并两个有序数组用双指针，每次取较小的那个；**相等时取左边的**，这是归并排序稳定的原因。递归树有 log n 层，每层合并的总工作量是 O(n)，所以任何输入都是 O(n log n)；合并需要临时数组，额外空间 O(n)。

```js
function mergeSort(nums, compare = (a, b) => a - b) {
  if (nums.length <= 1) return nums.slice()
  const mid = Math.floor(nums.length / 2)
  const left = mergeSort(nums.slice(0, mid), compare)
  const right = mergeSort(nums.slice(mid), compare)
  const merged = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    // <= 0：相等时先取左边的，保证稳定
    if (compare(left[i], right[j]) <= 0) merged.push(left[i++])
    else merged.push(right[j++])
  }
  return merged.concat(left.slice(i), right.slice(j)) // 接上剩下的一边
}
const people = [{ name: 'A', age: 30 }, { name: 'B', age: 25 }, { name: 'C', age: 30 }]
console.log(mergeSort(people, (a, b) => a.age - b.age).map((p) => p.name)) // ['B', 'A', 'C']
```

### 对比，以及堆排序

| | 快速排序 | 归并排序 | 堆排序 |
| --- | --- | --- | --- |
| 平均时间 | O(n log n) | O(n log n) | O(n log n) |
| 最坏时间 | O(n²)，随机基准让它极少出现 | O(n log n) | O(n log n) |
| 额外空间 | 递归栈，平均 O(log n) | O(n) | O(1) |
| 稳定 | 否 | 是 | 否 |
| 特点 | 原地、常数小、顺序访问内存 | 最坏有保证，适合链表排序和外部排序 | 原地且最坏有保证，但访问跳跃，常数较大 |

堆排序：先把数组建成大顶堆，再反复把堆顶（最大值）换到末尾、对剩下的部分做下沉调整，堆的原理见[堆和 Top K](/basics/algorithm/06-heap-topk)。

**稳定性**指相等的元素排序后保持原来的相对顺序。只排数字时看不出区别，按对象的某个字段排序时就很重要：表格先按姓名排好，再按部门排序，稳定排序能保证同一部门内仍按姓名有序，多级排序靠的就是这一点。

### JS 的 sort 有哪些坑

- 规范从 ES2019 起要求 `sort` 稳定；V8 从 7.0 版本起改用 TimSort（归并和插入排序的混合）
- 不传比较函数时，元素先转成字符串，再按 UTF-16 码元比较，`undefined` 排到最后，所以数字会排错
- 比较函数要返回负数、0 或正数。`(a, b) => a > b` 只返回布尔值，转成数字只有 1 和 0，结果因引擎而异，不可靠
- `sort` 原地修改并返回原数组；不想修改原数组用 ES2023 的 `toSorted`，或先拷贝一份
- 按语言习惯排字符串（如中文按拼音）用 `localeCompare` 或 `Intl.Collator`

```js
console.log([10, 9, 1].sort()) // [1, 10, 9]
console.log([10, 9, 1].sort((a, b) => a - b)) // [1, 9, 10]
console.log([3, 1, 2].sort((a, b) => a > b)) // [3, 1, 2]：在 V8 里根本没排
```

## 面试官可能追问

::: details 数组里有大量重复元素时，快排会怎样？
上面的 Lomuto 分区把等于基准的元素都分到右边，极端情况下全部元素相等，每次只排除一个，退化成 O(n²)。改用**三路划分**：把区间分成小于、等于、大于基准三段，等于的那段已经就位，只递归两边，重复元素越多越快。

```js
function quickSort3(nums, lo = 0, hi = nums.length - 1) {
  if (lo >= hi) return nums
  const pivot = nums[lo + Math.floor(Math.random() * (hi - lo + 1))]
  let [lt, i, gt] = [lo, lo, hi] // [lo, lt) < pivot，[lt, i) === pivot，(gt, hi] > pivot
  while (i <= gt) {
    if (nums[i] < pivot) swap(nums, lt++, i++)
    else if (nums[i] > pivot) swap(nums, i, gt--) // 换过来的元素还没检查，i 不动
    else i++
  }
  quickSort3(nums, lo, lt - 1)
  quickSort3(nums, gt + 1, hi)
  return nums
}
```
:::

::: details 怎么找数组中第 K 大的元素？
可以借用快排的分区，叫**快速选择**：分区后基准的位置 p 确定了，如果 p 正好是第 K 大应在的位置就返回，否则只递归包含目标的那一边。每次只处理一边，平均 O(n)，最坏 O(n²)，同样靠随机基准避免。它会修改原数组；数据量大或者是数据流时，用大小为 K 的堆更合适，见[堆和 Top K](/basics/algorithm/06-heap-topk)。
:::

::: details 链表排序为什么用归并？
堆排序依赖按下标随机访问，链表做不到；快排在链表上能写（按基准把节点分到三条链表），但随机选基准要先遍历到那个节点，常见写法直接拿头节点当基准，遇到有序链表就退化成 O(n²)。归并只需要顺序访问，最坏也是 O(n log n)，用快慢指针找中点拆分，合并两个有序链表也不需要额外数组，见[链表常见题](/basics/algorithm/07-linked-list)。时间 O(n log n)，递归写法的栈空间是 O(log n)。
:::

::: details 数据大到内存放不下，怎么排序？
用外部排序：把数据分块读进内存，每块排好序后写到临时文件；再同时打开这些文件，用一个最小堆做多路归并，每次取出堆顶写入结果，再从它所在的文件补一个元素进堆。
:::

## 易错点

- 快排固定选第一个或最后一个元素当基准，遇到有序数组退化成 O(n²)，递归太深还可能栈溢出
- 归并合并时写成 `<` 而不是 `<=`，相等元素先取了右边，失去稳定性
- `arr.sort()` 直接排数字，得到的是字符串顺序
- 忘了 `sort` 会修改原数组，比如在 React 里对状态数组原地排序后再传回同一个引用，不会触发重新渲染，应该用 `toSorted` 生成新数组
