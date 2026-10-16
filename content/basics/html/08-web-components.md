---
difficulty: 2
tags: [原理, 新技术]
---

# Web Components 是什么？Shadow DOM 解决了什么问题？

::: tip 一句话回答
Web Components 是浏览器原生的组件方案，由三部分组成：**Custom Elements** 用来定义自己的标签和生命周期；**Shadow DOM** 给组件挂一棵隔离的 DOM 子树；**`<template>`** 存放不会被渲染的 HTML 模板。它不依赖任何框架，适合**跨框架的组件库、嵌入第三方页面的挂件和微前端**。Shadow DOM 解决的是**封装**问题：页面的 CSS 选不中组件内部，组件的 CSS 也漏不出去，外部脚本用 `querySelector` 也查不到内部元素。
:::

## 详细解析

### Custom Elements

用 `customElements.define('my-counter', MyCounter)` 注册。名字必须以小写字母开头并且**包含连字符**，用来和原生标签区分。类继承 `HTMLElement`（自主自定义元素）。还有一种继承原生元素、用 `is` 属性使用的写法，但 Safari 明确不支持，实际很少用。

| 生命周期 | 什么时候调用 | 适合做什么 |
| --- | --- | --- |
| `constructor` | 元素创建或升级时 | 先调用 `super()`，初始化状态、`attachShadow`；不要读写特性和子元素 |
| `connectedCallback` | 每次插入文档时 | 渲染、绑定全局事件、发请求；元素被移动时会再次调用 |
| `disconnectedCallback` | 每次从文档移除时 | 清理定时器和全局监听器 |
| `attributeChangedCallback` | `observedAttributes` 里列出的特性变化时 | 同步内部状态并更新界面 |
| `adoptedCallback` | 被移动到另一个 document 时 | 很少用到 |

如果 HTML 里先写了标签、后注册定义，浏览器会把已有元素**升级**。写在 HTML 里的初始特性，会在 `connectedCallback` 之前触发一次 `attributeChangedCallback`。注册前的元素可以用 `:not(:defined)` 隐藏，避免闪烁；`customElements.whenDefined('my-counter')` 返回一个在注册后 resolve 的 Promise。

### Shadow DOM

`this.attachShadow({ mode: 'open' })` 创建影子根，组件的内部结构放在里面。`open` 时外部可以通过 `el.shadowRoot` 访问；`closed` 时返回 `null`，但它只是表明"不要访问内部"，并不是安全机制。

- **样式隔离**：外部的选择器选不中内部元素，内部的样式也只作用于内部。但 `color`、`font` 这类可继承的属性会从宿主继承进来，CSS 变量也能穿透，所以主题定制一般通过 CSS 变量；想让使用者改某个内部元素，可以给它加 `part="button"`，外部用 `my-counter::part(button)` 选中
- **`:host`**：在组件内部选中宿主元素本身，设置默认的 `display` 等样式；外部给宿主写的样式优先级更高
- **slot 插槽**：使用者写在标签里的子元素，通过内部的 `<slot>` 投影显示，具名插槽用 `slot="name"` 对应。这些子元素仍然属于外部 DOM，受页面样式控制，组件内部用 `::slotted()` 只能选中它们的顶层元素
- **事件重定向**：内部元素触发的事件冒泡到外部时，`event.target` 会被改成宿主元素，外部看不到内部结构。从内部元素派发的自定义事件，要设置 `bubbles: true, composed: true` 才能穿出影子根

### template

`<template>` 里的内容会被解析，但不渲染、不执行脚本、不加载图片。用 `template.content.cloneNode(true)` 克隆出来使用，每个组件实例复用同一份模板。

## 代码示例

```html
<my-counter count="3">
  <span slot="label">点击次数</span>
</my-counter>

<script type="module">
  const tpl = document.createElement('template')
  tpl.innerHTML = `
    <style>
      :host { display: inline-flex; gap: 8px; align-items: center; }
      button { font: inherit; color: var(--counter-color, #2563eb); }
    </style>
    <slot name="label">计数</slot>
    <button part="button" type="button"></button>
  `

  class MyCounter extends HTMLElement {
    static observedAttributes = ['count']

    constructor() {
      super()
      this.attachShadow({ mode: 'open' }).append(tpl.content.cloneNode(true))
      this.button = this.shadowRoot.querySelector('button')
      this.button.addEventListener('click', () => {
        this.count += 1
        // 在宿主上派发，外部可以直接监听；从影子根内部的元素派发时还要加 composed: true
        this.dispatchEvent(new CustomEvent('count-change', { detail: this.count, bubbles: true }))
      })
    }

    // 特性只能是字符串，用 getter/setter 包装成数字类型的属性
    get count() { return Number(this.getAttribute('count') ?? 0) }
    set count(v) { this.setAttribute('count', String(v)) }

    connectedCallback() { this.render() }
    attributeChangedCallback() { this.render() }
    render() { this.button.textContent = this.count }
  }

  customElements.define('my-counter', MyCounter)
  document.addEventListener('count-change', (e) => console.log('当前计数', e.detail))
</script>
```

### 在 Vue 和 React 里使用

- **特性和属性**：HTML 特性（attribute）只能是字符串，对象和数组要通过 DOM 属性（property）传。Vue 会先用 `in` 检查元素上有没有这个属性，有就按属性设置，也可以用 `.prop` 修饰符强制；React 默认按特性设置，非字符串会被转成字符串，但如果元素类在构造时就有这个属性，React 会直接设置属性
- **自定义事件**：Vue 用 `@count-change` 直接监听；React 用 `on` 加上**原样的事件名**，写成 `oncount-change`。较早的 React 版本既不支持监听自定义事件，也只会设置字符串特性，需要拿 ref 手动 `addEventListener` 和赋值
- **Vue 的编译配置**：要在构建工具的 `compilerOptions.isCustomElement` 里声明哪些标签是自定义元素，否则 Vue 会把它当成未注册的组件并报警告

### 适用场景和局限

- 适合：多个技术栈共用的基础组件库；嵌入别人页面的客服、评论挂件，用 Shadow DOM 避免和宿主页面的样式互相污染；微前端里用自定义元素承载子应用，见 [微前端](/basics/build/12-micro-frontend)
- 局限：响应式数据、模板更新要自己做，通常配合 Lit 这类轻量库；原本 Shadow DOM 必须由 JS 创建，不利于 SSR，**Declarative Shadow DOM**（`<template shadowrootmode="open">`）让服务端可以直接在 HTML 里输出影子根；`aria-labelledby` 这类 id 引用不能跨越影子根边界

## 面试官可能追问

::: details 组件放进 Shadow DOM 后，外部真的完全改不了样式吗？
不是。可继承属性（字体、颜色）会继承进来；CSS 变量可以穿透，这是最常用的主题定制方式；`::part()` 可以选中组件主动暴露的部件；外部直接写在宿主元素上的样式，优先级高于组件内部的 `:host` 规则。外部改不了的只是组件没有暴露的内部细节。
:::

::: details 为什么不建议在 constructor 里读取特性和子元素？
用 `document.createElement('my-counter')` 创建元素时，constructor 执行时还没有任何特性和子元素；规范也要求 constructor 里不能给元素添加特性或子元素。读取初始值、渲染界面应该放到 `connectedCallback` 和 `attributeChangedCallback` 里。
:::

::: details Web Components 和 Vue、React 组件怎么选？
不是互相替代的关系。应用内部的业务组件用框架组件开发效率更高，有完整的状态管理和生态；需要跨框架复用、嵌入到不受控制的页面、或者要求强样式隔离时，用 Web Components 更合适。Vue 的 `defineCustomElement` 也能把 Vue 组件包装成自定义元素，两者可以结合使用。
:::

## 易错点

- 自定义元素名不带连字符，`define` 会直接报错
- `connectedCallback` 每次插入文档都会调用，元素在 DOM 中移动也会触发，初始化逻辑要防止重复执行，并在 `disconnectedCallback` 里清理
- 把 `mode: 'closed'` 当成安全手段，浏览器插件等方式仍然能访问内部
- 用特性传对象或数组，结果收到的是 `"[object Object]"` 这样的字符串
