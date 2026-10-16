---
difficulty: 2
tags: [原理]
---

# Vue 的模板是怎么变成真实 DOM 的？模板编译经过哪些步骤？

::: tip 一句话回答
分两大阶段。**编译阶段**把模板字符串变成 render 函数：**parse** 解析成 AST，**transform** 处理指令并标记静态节点和动态部分，**generate** 把 AST 拼成 render 函数代码。**运行阶段**执行 render 函数得到 VNode 树，再由渲染器 **patch** 成真实 DOM；数据变化时重新执行 render，新旧 VNode 对比后只更新变化的部分。工程项目里编译在**构建时**由 vue-loader 或 Vite 插件完成，浏览器里只跑运行时版本。
:::

## 详细解析

### 整体流程

```text
模板字符串
   │ parse
   ▼
模板 AST（描述标签、属性、指令、插值的树）
   │ transform
   ▼
处理后的 AST（v-if/v-for 转成对应结构，打上静态标记和 PatchFlag）
   │ generate
   ▼
render 函数代码            ← 以上是编译阶段，通常在构建时完成
   │ 执行 render（期间读取响应式数据，收集依赖）
   ▼
VNode 树
   │ patch / mount
   ▼
真实 DOM                   ← 数据变化后重新 render，新旧 VNode diff
```

### parse：字符串到 AST

解析器从头扫描模板，识别开始标签、属性、文本、`{{ }}` 插值、结束标签，按嵌套关系建出一棵树。每个节点记录类型、标签名、属性和指令列表，以及在源码里的位置，编译报错时能指到具体的行。

### transform：理解语义

AST 只是"长什么样"，transform 负责"是什么意思"：

- 把 `v-if`、`v-for`、`v-on`、`v-model` 等指令转成对应的代码结构
- 分析每个节点哪些部分是动态的，打上 PatchFlag，比如只有文本动态，或者只有 class 动态
- 找出完全静态的节点，后续可以提升到 render 函数外面复用

这些标记是 Vue 3 运行时快的关键，细节见 [编译优化](/basics/vue/08-compiler-optimization)。

### generate：生成代码

把处理后的 AST 拼成一段 JS 代码字符串，也就是 render 函数。下面是简化示意，不是编译器的原样输出：

```js
// 模板：<div class="box">{{ msg }}</div>
import { toDisplayString as _toDisplayString, openBlock as _openBlock, createElementBlock as _createElementBlock } from 'vue'

export function render(_ctx) {
  return (_openBlock(), _createElementBlock('div', { class: 'box' },
    _toDisplayString(_ctx.msg), 1 /* TEXT */))
}
```

最后的 `1` 就是 PatchFlag，告诉运行时这个节点只有文本需要比对。想看真实输出，可以在 Vue 官方的模板编译在线工具里贴模板。

### 运行阶段：render、VNode、patch

组件挂载时，Vue 用一个响应式副作用包住"执行 render 再 patch"这件事。render 执行时读到的响应式数据都会被收集为依赖，数据一变，副作用重新执行，得到新的 VNode 树，再和旧树 diff，只改动有变化的 DOM。diff 的过程见 [虚拟 DOM 和 diff](/basics/vue/07-vdom-diff)，依赖收集见 [响应式原理](/basics/vue/01-reactivity)。

### 构建时编译和运行时编译

| | 构建时编译 | 运行时编译 |
| --- | --- | --- |
| 编译发生在 | 打包时，vue-loader 或 Vite 的 Vue 插件处理 `.vue` 文件 | 浏览器里，页面加载后 |
| 需要的 Vue 版本 | 仅运行时版本，体积更小 | 完整版（包含编译器） |
| 适用 | 绝大多数工程项目 | 直接在 HTML 里写模板、模板来自后端字符串 |

打包工具里默认引入的是仅运行时版本。如果代码里用了 `template: '<div>...</div>'` 这种字符串模板，又没换成完整版，页面不会渲染，控制台会提示需要编译器。

## 面试官可能追问

::: details 为什么要先编译成 render 函数，而不是直接解析模板操作 DOM？
render 函数是纯 JS，执行快，可以反复调用；模板解析只做一次，结果还能缓存。编译期还能做静态分析，把"哪些地方会变"提前告诉运行时，这是直接操作 DOM 做不到的。
:::

::: details 手写 render 函数或 JSX 能享受编译优化吗？
基本享受不到。手写的 `h()` 调用没有 PatchFlag 和静态提升，运行时只能做完整的 diff。所以 Vue 推荐优先用模板，需要高度动态的逻辑时再用 render 函数或 JSX。
:::

::: details SFC 里的 script 和 style 也是这个编译器处理的吗？
不完全是。`.vue` 文件先被 SFC 编译器拆成三块：template 走上面的模板编译，`<script setup>` 被编译成标准的组件选项（编译宏在这一步被处理，见 [script setup](/basics/vue/20-script-setup)），style 交给 CSS 处理链，`scoped` 会加上属性选择器。
:::

## 易错点

- 以为浏览器每次都在解析模板。工程项目里模板在构建时就变成了 render 函数，浏览器拿到的是 JS
- 把"虚拟 DOM"等同于"模板编译"。编译产出的是 render 函数，执行 render 才得到 VNode
- 用打包工具时写字符串 `template`，没有切换到包含编译器的版本，导致组件不渲染
