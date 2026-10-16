---
difficulty: 1
tags: [高频]
---

# 伪类和伪元素有什么区别？::before 和 ::after 能做什么？

::: tip 一句话回答
**伪类**按状态或位置选中**已经存在的元素**，比如 `:hover`、`:focus-visible`、`:nth-child()`，相当于给元素临时加了一个看不见的类；**伪元素**选中元素的**某一部分**，或者**生成一个虚拟的子元素**，比如 `::first-line`、`::before`。写法上伪类用单冒号，伪元素用双冒号（`::before` 等四个老伪元素也兼容单冒号）。`::before` / `::after` **必须设置 `content`** 才会渲染，`img` 这类替换元素上不生效，常用来做装饰、图标、清除浮动、计数器和扩大点击区域。
:::

## 详细解析

### 两者的区别

| | 伪类 | 伪元素 |
| --- | --- | --- |
| 选中什么 | 处于某种状态或位置的元素本身 | 元素的一部分，或生成的虚拟子元素 |
| 写法 | 单冒号：`:hover` | 双冒号：`::before`；`:before`、`:after`、`:first-line`、`:first-letter` 是 CSS2 的旧写法，浏览器仍然支持 |
| 是否在 DOM 中 | 元素就在 DOM 里 | 不在 DOM 里，`querySelector` 选不到 |
| 在选择器里的位置 | 可以叠加，如 `a:hover:focus-visible` | 必须写在最后，`p::first-line > span` 是无效选择器 |
| 优先级 | 和类选择器同级 | 和标签选择器同级 |

### 常用伪类

- **用户交互**：`:hover`、`:active`、`:focus`、`:focus-visible`。`:focus-visible` 由浏览器判断"是否需要明显的焦点提示"，键盘 Tab 过来时匹配，鼠标点击按钮时通常不匹配，适合写焦点框
- **结构位置**：`:first-child`、`:last-child`、`:nth-child(2n + 1)`、`:nth-of-type()`、`:empty`
- **表单状态**：`:checked`、`:disabled`、`:invalid`、`:placeholder-shown`
- **逻辑组合**：`:not()`、`:is()`、`:where()`、`:has()`

`:has()` 让 CSS 第一次能**根据后代或后面的兄弟选中元素**，比如 `.card:has(img)` 选中包含图片的卡片，`h2:has(+ p)` 选中后面紧跟段落的标题。`:has()` 不能嵌套在另一个 `:has()` 里，参数里也不能写伪元素。

`:is()` 和 `:where()` 匹配的元素完全一样，区别只在优先级：`:is()` 取参数里最高的，`:where()` 永远是 0，计算方法见 [选择器优先级](/basics/css/03-specificity)。

### 常用伪元素

- `::before` / `::after`：在元素内容的**最前面 / 最后面**生成一个子元素，默认是行内元素
- `::first-line` / `::first-letter`：首行、首字，做首字下沉
- `::placeholder`：输入框的占位文字；`::selection`：用户选中的文字
- `::marker`：列表项的符号或编号，只支持颜色、字体、`content` 等少数属性
- `::backdrop`：顶层元素（如模态 `dialog`）后面的遮罩

### ::before 和 ::after 的规则

1. **必须有 `content`**：不写、值无效、或者是 `none` / `normal` 时不渲染，相当于 `display: none`。只做装饰时写 `content: ""`
2. **是子元素，不是兄弟**：它们插在元素自己的内容前后，所以宿主必须能容纳子内容。`img`、`video` 这类**替换元素**内容来自外部资源，用不了；`input` 等表单控件在各浏览器里的表现也不可靠，不要依赖
3. **默认是 `inline`**：要设宽高，改成 `block` / `inline-block`，或者绝对定位（宿主加 `position: relative`）
4. **不能单独绑事件**：点击伪元素时，事件的目标是宿主元素

## 代码示例

```css
/* 计数器：步骤编号由 CSS 生成，HTML 里不用写数字 */
.steps {
  counter-reset: step;
  list-style: none;
}
.steps li::before {
  counter-increment: step;
  content: counter(step);
  display: inline-grid;
  place-items: center;
  width: 1.5em;
  height: 1.5em;
  margin-right: 0.5em;
  border-radius: 50%;
  background: #3b82f6;
  color: #fff;
}

/* 用 data 属性做简单的提示气泡：<span class="tip" data-tip="复制链接"> */
.tip {
  position: relative;
}
.tip:hover::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 4px;
  background: #333;
  color: #fff;
  white-space: nowrap;
}

/* 图标按钮视觉上 16px，可点击区域向外扩 12px */
.icon-btn {
  position: relative;
}
.icon-btn::after {
  content: "";
  position: absolute;
  inset: -12px;
}
```

清除浮动的 clearfix 写法见 [浮动](/basics/css/17-float)，用边框画三角形见 [常见文本和图形效果](/basics/css/18-text-tricks)。

## 面试官可能追问

::: details JS 能读取或修改伪元素的样式吗？
能读，不能直接改。读取用 `getComputedStyle(el, '::before')`，比如拿到它的 `content`。修改只能间接做：切换宿主元素的类名，或者让伪元素的样式引用 CSS 变量，再用 `el.style.setProperty('--x', '10px')` 修改宿主上的变量，伪元素会跟着变。
:::

::: details 伪元素里放文字有什么问题？
生成的内容不在 DOM 里，读屏器的支持不一致，用户一般也无法选中和复制。按钮文字、价格这类重要信息要写在 HTML 里，伪元素只放装饰性的内容，比如图标、引号、分隔符。
:::

::: details :has() 会不会有性能问题？
它需要检查元素的后代或兄弟，选择器写得太宽时开销会变大。不要把它挂在 `body`、`:root`、`*` 这种子树很大的元素上，例如 `body:has(.modal-open)` 最好换成更具体的容器；参数里尽量用 `>`、`+` 限定范围，比如 `.card:has(> img)`，减少需要遍历的节点。
:::

## 易错点

- 忘了写 `content`，`::before` / `::after` 根本不出现
- 在 `img`、`input` 上写 `::before` 期待显示图标，实际不生效，应该包一层元素或改用背景图
- `li:nth-child(2)` 的意思是"第 2 个子元素，并且它是 `li`"，不是"第 2 个 `li`"；按类型数要用 `:nth-of-type(2)`
- 伪类的优先级和类相同，伪元素和标签相同，`:where()` 是 0，三者不要混为一谈
