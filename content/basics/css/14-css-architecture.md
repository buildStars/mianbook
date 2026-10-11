---
difficulty: 2
tags: [对比, 实践]
---

# CSS 模块化方案有哪些？CSS Modules、CSS-in-JS、Tailwind 怎么选？

::: tip 一句话回答
CSS 的类名默认是全局的，项目一大就会互相覆盖。解决思路有四类：**命名约定**（BEM）靠人遵守；**CSS Modules** 和 **Vue scoped** 在编译时给类名或元素加上唯一标识，实现局部作用域；**CSS-in-JS** 把样式写进组件，能直接用 JS 变量，但运行时方案有性能和 SSR 成本；**Tailwind** 这类原子化方案几乎不写自定义类名，从根上避开命名和冲突。选型看技术栈、团队习惯和是否重度依赖 SSR。
:::

## 详细解析

### 全局样式的问题

所有 CSS 文件最终合在一个全局作用域里。两个组件都写了 `.title`，后加载的会覆盖先加载的；删掉一段样式时也不敢确定还有没有别处在用。层级越写越深、优先级越堆越高，最后只能靠 `!important`。

### BEM：命名约定

`.block__element--modifier`，比如 `.card__title--active`。类名带上组件前缀，选择器保持一层，优先级扁平、可读性好。缺点是全靠人遵守，名字长，没有工具层面的保证。

### CSS Modules 和 Vue scoped

**CSS Modules**：构建工具把 `Button.module.css` 里的类名编译成带哈希的唯一名字（如 `Button_primary_a1b2c`，具体格式由构建工具配置决定），并导出一个"原名 → 新名"的映射对象，组件里用 `styles.primary` 引用。需要全局类名时用 `:global(.xxx)`。

**Vue scoped**：编译时给组件模板里的元素加上 `data-v-xxxx` 属性，同时把样式选择器改写成 `.title[data-v-xxxx]`，这样样式只匹配本组件的元素。子组件的根元素会同时带上父组件的标识，所以父组件可以给子组件根元素加样式；想影响子组件内部，要用 `:deep()`。

两者都是**编译时**方案，没有运行时开销，产物还是普通 CSS 文件。

### CSS-in-JS

以 styled-components、Emotion 为代表的**运行时**方案，在组件渲染时根据 props 生成样式、插入 `style` 标签。好处是样式和组件同处一处，动态样式写起来自然。代价是：

- 渲染时要序列化样式、计算哈希、插入规则，组件多、更新频繁时有开销
- SSR 需要额外收集渲染过程中产生的样式并注入 HTML，配置复杂
- 依赖 React Context 和客户端运行时，不能直接写在 React Server Components 里，只能用在客户端组件中，并且要库本身适配流式渲染（例如 Next.js App Router 要额外配一个样式收集的 registry）

因此出现了**零运行时**方案，例如 vanilla-extract、Linaria：写法类似 CSS-in-JS，构建时就抽取成静态 CSS 文件。

### Tailwind：原子化 CSS

每个类名只做一件事，如 `flex`、`p-4`、`text-gray-500`，直接写在 HTML 上组合。构建时扫描源码，只生成用到的类。

- 优点：不用起名，不会冲突；CSS 体积随项目增长很慢；间距、颜色受设计规范约束，风格统一；删组件不会留下无用样式
- 缺点：模板里类名很长，可读性下降；需要记一套类名；复杂样式（如复杂动画、伪元素）写起来别扭

### 怎么选

| 场景 | 推荐 |
| --- | --- |
| Vue 项目 | scoped 为主，配合 CSS 变量；喜欢原子化可以加 Tailwind |
| React 项目 | CSS Modules 或 Tailwind；需要强动态样式时考虑零运行时 CSS-in-JS |
| 重度 SSR、关注首屏性能 | 避免运行时 CSS-in-JS |
| 组件库 | 稳定的类名前缀（类 BEM）+ CSS 变量，方便使用方覆盖 |
| 后台、快速迭代的业务页面 | Tailwind 效率高 |

## 代码示例

```jsx
// CSS Modules：Button.module.css 里写 .btn 和 .primary
import styles from './Button.module.css'

export function Button({ primary, children }) {
  // 编译后 class 类似 "Button_btn_x1y2z Button_primary_a1b2c"
  return (
    <button className={`${styles.btn} ${primary ? styles.primary : ''}`}>
      {children}
    </button>
  )
}
```

```vue
<template>
  <div class="card">
    <ChildList />
  </div>
</template>

<style scoped>
/* 编译后：.card[data-v-7ba5bd90] */
.card { padding: 16px; }

/* 修改子组件内部的元素：编译后 .card[data-v-7ba5bd90] .item */
.card :deep(.item) { color: #666; }
</style>
```

## 面试官可能追问

::: details Tailwind 里为什么不能拼接类名？
Tailwind 是扫描源码文本，找出完整的类名字符串来生成 CSS 的，不会执行代码。写成 `` `text-${color}-500` `` 时，源码里不存在完整的 `text-red-500`，这个类就不会被生成。要么把完整类名写全放进映射对象，要么用安全列表强制生成（不同大版本的配置方式不同）。
:::

::: details scoped 样式能防住所有冲突吗？
不能。scoped 只是给选择器加了属性条件，优先级会因此略微提高，但全局样式里的同名类、元素选择器照样会作用到组件上。另外 `v-html` 插入的内容没有 `data-v` 属性，scoped 样式匹配不到，要用 `:deep()` 或全局样式。
:::

::: details CSS Modules 和 scoped 的实现有什么不同？
CSS Modules 改的是**类名**，样式和模板都使用编译后的新类名；scoped 不改类名，改的是**选择器和元素属性**，用属性选择器做隔离。所以 CSS Modules 产物里看不到原始类名，而 scoped 的类名保持原样，更方便调试，也方便外部覆盖。
:::

## 易错点

- Vue scoped 不是 Shadow DOM，只是编译时加属性选择器，隔离并不彻底
- CSS-in-JS 不等于运行时开销，零运行时方案在构建时就产出静态 CSS
- Tailwind 的类名必须在源码里完整出现，动态拼接会导致样式丢失
