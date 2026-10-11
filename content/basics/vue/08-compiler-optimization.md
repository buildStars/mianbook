---
difficulty: 3
tags: [原理]
---

# Vue 3 在编译阶段做了哪些优化？

::: tip 一句话回答
Vue 的模板可以被静态分析，编译器在生成渲染函数时加入"提示"，让运行时跳过不必要的工作。主要有四项：**PatchFlag** 标记节点的哪些部分是动态的，更新时只比较这些部分；**Block Tree** 把动态节点收集到扁平数组里，跳过静态的层级结构；**静态内容**只创建一次，之后直接复用；**事件处理函数缓存**避免子组件不必要的重新渲染。
:::

## 详细解析

### 为什么模板能优化

模板的语法是受限的：哪些节点是纯静态的、哪些属性绑定了变量，编译时就能确定。编译器把这些信息写进渲染函数，运行时据此跳过不需要比较的内容。这是模板相对 JSX 的优势：JSX 就是 JS，里面可以写任意逻辑，很难做同样的分析，所以手写的 render 函数和 JSX 一般享受不到下面这些优化。

### PatchFlag：标记动态的部分

编译器给动态节点打上 PatchFlag，说明它的哪一部分是动态的。更新时只比较这些部分，其余内容直接跳过。

| PatchFlag | 值 | 含义 |
| --- | --- | --- |
| `TEXT` | 1 | 文本内容是动态的 |
| `CLASS` | 2 | `class` 是动态的 |
| `STYLE` | 4 | `style` 是动态的 |
| `PROPS` | 8 | 有 class、style 之外的动态属性，并额外记录是哪几个属性 |
| `FULL_PROPS` | 16 | 属性名本身是动态的（如 `v-bind="obj"`），需要完整比较 |

每种标记占一个二进制位，可以组合使用：文本和 class 都是动态的节点，PatchFlag 就是 `TEXT | CLASS`，也就是 3。

### Block Tree：只遍历动态节点

带有动态内容的区域根节点（比如组件模板的根节点）是一个 block。它会把内部所有动态的后代节点，不管嵌套多深，都收集到一个扁平数组 `dynamicChildren` 中。更新时直接遍历这个数组，和旧 block 的 `dynamicChildren` 一一对应地比较，静态的层级结构完全跳过。

一一对应的前提是动态节点的数量和顺序稳定。所以 `v-if`、`v-for` 这类可能改变结构的指令会创建新的 block：`v-if` 的每个分支各是一个 block，切换分支时整体替换；`v-for` 的列表也是一个 block，列表项之间按正常的 diff 比较。

### 静态内容：只创建一次

没有任何绑定的纯静态节点，只在第一次渲染时创建 VNode，之后每次渲染都直接复用，diff 时也会直接跳过。早期版本把它们提升到渲染函数外部，称为静态提升（hoistStatic）；Vue 3.5 中改为缓存在渲染函数的 `_cache` 里，思路不变。

连续的静态节点足够多时，编译器还会把它们**预字符串化**：合并成一段 HTML 字符串，挂载时通过 `innerHTML` 一次性创建 DOM，比逐个创建节点更快，也减少了 VNode 的数量。

### 事件处理函数缓存

`@click="count++"` 这样的内联处理函数，如果不缓存，每次渲染都会生成一个新函数。编译器把它缓存在 `_cache` 中，之后的渲染复用同一个函数。传给子组件时，props 中的函数引用不变，子组件不会因此重新渲染；用在元素上时，这个属性也不再算作动态属性。

## 代码示例

模板：

```vue
<template>
  <div>
    <p>{{ msg }}</p>
    <span :class="cls">状态</span>
    <input :value="val" placeholder="请输入" />
    <button @click="count++">点击</button>
  </div>
</template>
```

简化后的编译产物（省略了 import；实际产物会把 `["value"]` 提升为模块顶部的常量）：

```js
export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", null, [
    _createElementVNode("p", null, _toDisplayString(_ctx.msg), 1 /* TEXT */),
    _createElementVNode("span", {
      class: _normalizeClass(_ctx.cls)
    }, "状态", 2 /* CLASS */),
    _createElementVNode("input", {
      value: _ctx.val,
      placeholder: "请输入"
    }, null, 8 /* PROPS */, ["value"]),
    _createElementVNode("button", {
      onClick: _cache[0] || (_cache[0] = $event => (_ctx.count++))
    }, "点击")
  ]))
}
```

- 根节点 `div` 是一个 block，它的 `dynamicChildren` 只有 `p`、`span`、`input` 三个节点
- 更新时 `p` 只比较文本，`span` 只比较 `class`，`input` 只比较 `value`，不会去比较 `placeholder`
- `button` 的处理函数被缓存了，节点上没有任何动态内容，更新时直接跳过

在 Vue SFC Playground 中写一段模板，就能在输出面板看到编译后的代码，适合动手验证。

## 面试官可能追问

::: details PatchFlag 为什么用位运算？
一个节点可能同时有多种动态内容，比如文本和 class 都是动态的。用不同的二进制位表示不同的类型，一个整数就能存下所有组合。运行时用 `&` 判断是否包含某种类型，比如 `patchFlag & PatchFlags.CLASS`，一次位运算就能完成，比查数组或对象更快、更省内存。
:::

::: details 遇到 v-if 为什么要创建新的 block？
block 更新时，新旧两份 `dynamicChildren` 是按位置一一对应比较的，这要求动态节点的数量和顺序稳定。`v-if` 切换分支后，结构可能完全不同，动态节点的数量和顺序都对不上，没法一一对应。所以每个分支单独作为一个 block，并带有不同的 key，切换时整体替换。`v-for` 同理，列表长度会变，它的列表项交给正常的 diff 处理。
:::

::: details JSX 能做这些优化吗？
很难做到同等程度。模板的语法受限，编译器能确定哪些部分是静态的；JSX 就是 JS 表达式，可以出现任意的条件、循环、展开运算和函数调用，编译时无法可靠地判断哪些值会变。所以 JSX 和手写的 render 函数通常只能做完整的 diff，这也是 Vue 默认推荐使用模板的原因之一。
:::

## 易错点

- PatchFlag 只说明"哪部分是动态的"，不代表这部分一定变了，运行时仍要比较新旧值
- 这些优化都在编译时完成，手写 render 函数或 JSX 一般享受不到
- Block 收集动态节点时不管嵌套多深，都放进同一个扁平数组，而不是按树的层级逐层比较
