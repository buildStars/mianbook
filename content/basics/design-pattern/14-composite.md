---
difficulty: 1
tags: [原理]
---

# 组合模式是什么？树形结构怎么统一处理？

::: tip 一句话回答
组合模式让**叶子节点和容器节点实现同一个接口**，调用方不用区分"这是单个对象还是一组对象"，统一调用就行；容器在内部把调用**递归地转发**给子节点。它适合文件树、菜单、组件树、权限树这种"部分-整体"的树形结构。按接口设计分为**透明式**（叶子也有 `add`、`remove`）和**安全式**（只有容器有），前者调用统一，后者更不容易误用。
:::

## 详细解析

### 解决什么问题

算一个文件夹的总大小：文件夹里有文件，也有子文件夹，子文件夹里还有文件。如果调用方自己判断类型：

```js
function size(node) {
  if (node.type === 'file') return node.size
  let total = 0
  for (const child of node.children) total += size(child)
  return total
}
```

每加一种操作（统计数量、搜索、渲染），都要再写一遍类型判断和递归。组合模式把这个判断收进节点自己：文件的 `getSize()` 返回自身大小，文件夹的 `getSize()` 返回子节点 `getSize()` 之和。调用方只管调 `root.getSize()`。

### 结构

```text
        Component（统一接口：getSize、render ...）
          ▲                    ▲
          │                    │
        Leaf                Composite
   （直接完成工作）   （持有 children，递归转发）
```

关键点是 Composite 的 children 类型也是 Component，所以能无限嵌套。

### 常见例子

- **文件树**：文件和文件夹，统计大小、搜索、删除
- **菜单**：菜单项和子菜单，渲染时递归，点击时叶子执行动作
- **组件树**：Vue、React 的组件既可以是单个元素，也可以包含子组件，渲染就是递归
- **权限树**：勾选父节点等于勾选所有子节点，父节点的状态由子节点汇总（全选、半选）
- **表达式树**：数字是叶子，运算符是容器，`evaluate()` 递归求值

### 透明式和安全式

| 方式 | 接口里有没有 `add`、`remove` | 优点 | 缺点 |
| --- | --- | --- | --- |
| 透明式 | 有，叶子也有（调用时报错或空实现） | 调用方完全不用区分类型 | 叶子上调 `add` 运行时才发现错 |
| 安全式 | 没有，只有容器有 | 类型上就不允许误用 | 管理子节点时需要判断类型 |

前端用 TypeScript 时更常见安全式：公共接口只放"都能做"的操作，`add` 只在容器类型上。

### 和二叉树算法题的区别

[二叉树](/basics/algorithm/08-binary-tree) 关注的是遍历顺序、查找、平衡这类算法问题，节点结构固定。组合模式是一种设计思路，关注"怎么让调用方用同一套接口处理单个对象和对象组合"，树的形状是业务决定的，子节点数量也不固定。

## 代码示例

```js
class File {
  constructor(name, size) { Object.assign(this, { name, size }) }
  getSize() { return this.size }
  print(indent = '') { console.log(`${indent}${this.name} (${this.size})`) }
}

class Folder {
  constructor(name) { this.name = name; this.children = [] }
  add(...nodes) { this.children.push(...nodes); return this }
  // 容器把调用递归转发给子节点
  getSize() { return this.children.reduce((sum, c) => sum + c.getSize(), 0) }
  print(indent = '') {
    console.log(`${indent}${this.name}/ (${this.getSize()})`)
    this.children.forEach((c) => c.print(indent + '  '))
  }
}

const root = new Folder('src').add(
  new File('main.js', 120),
  new Folder('components').add(new File('Button.vue', 80), new File('Modal.vue', 200)),
)
root.print()
// src/ (400)
//   main.js (120)
//   components/ (280)
//     Button.vue (80)
//     Modal.vue (200)
console.log(root.getSize()) // 400，调用方不关心是文件还是文件夹
```

## 面试官可能追问

::: details 树很深时递归会有什么问题？怎么办？
层级极深时可能栈溢出，文件树、菜单一般不会遇到。真遇到了可以改成用显式栈的迭代遍历。另一个问题是重复计算，比如上面 `print` 里每层都调一次 `getSize`，会反复遍历子树，数据大时可以缓存结果，子节点变化时让缓存失效。
:::

::: details 权限树的"半选"状态怎么用组合模式实现？
叶子节点的状态就是自己是否勾选；容器节点的状态由子节点汇总：全部勾选为"全选"，全部未勾选为"未选"，否则为"半选"。勾选容器时递归把状态设给所有子节点。调用方只需要调用统一的 `getState()`、`setChecked()`。
:::

::: details 组合模式和装饰器模式都会递归包装，有什么区别？
装饰器是一个对象包一个对象，目的是给它**增加功能**，结构是一条链。组合是一个容器包含多个子节点，目的是**统一处理整体和部分**，结构是一棵树。
:::

## 易错点

- 调用方仍然到处 `if (node.type === 'folder')`，没有把差异收进节点自己的方法
- 透明式里叶子的 `add` 静默忽略，问题被掩盖，最好直接抛错
- 把组合模式等同于"树的遍历算法"：它解决的是接口统一，不是遍历顺序
