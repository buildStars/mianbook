---
difficulty: 2
tags: [高频, 实践]
---

# CSS 变量怎么用？怎么实现暗色模式和主题切换？

::: tip 一句话回答
CSS 变量（自定义属性）用 `--name: value` 声明，用 `var(--name, 回退值)` 读取，它**参与层叠和继承**，可以在不同选择器、媒体查询里重新赋值，也能被 JS **在运行时修改**，这是它和 Sass 编译期变量的本质区别。主题切换的做法是：颜色全部引用变量，在根元素上通过 **class 或 `data-theme`** 切换一组变量值，默认跟随系统的 `prefers-color-scheme`；为了避免首屏闪烁，在 `head` 里用**内联脚本**提前设置主题。
:::

## 详细解析

### 语法、作用域与继承

- 声明：`--brand: #3b82f6;`，名字区分大小写
- 读取：`color: var(--brand);`，第二个参数是回退值：`var(--brand, blue)`
- 作用域：在哪个选择器里声明，就在那个元素及其后代上生效。写在 `:root` 上就是全局变量，写在 `.card` 上只影响卡片内部
- 继承：自定义属性默认会继承，子元素可以覆盖，覆盖后只影响自己的子树

回退值只在变量**没有定义**（或被设成 `initial`）时使用。如果变量定义了、但值对当前属性不合法（比如 `--size: red` 用在 `width` 上），这条声明在计算值阶段才失效（规范叫 invalid at computed-value time），效果相当于 `unset`：可继承属性取父元素的值，其他属性取初始值，而不是回到前面写过的其他声明，也不会用 `var()` 的回退值。

### 和预处理器变量的区别

| | CSS 变量 | Sass / Less 变量 |
| --- | --- | --- |
| 生效时机 | 运行时，浏览器解析 | 编译时，编译后变量消失 |
| 层叠与继承 | 参与，可按 DOM 位置取不同值 | 不参与，只有词法作用域 |
| 媒体查询中重新赋值 | 可以 | 不行，只能写多套样式 |
| JS 读写 | 可以 | 不行 |
| 用在媒体查询条件里 | 不行 | 可以 |

### JS 读写

`getComputedStyle(el).getPropertyValue('--brand')` 读取计算后的值，`el.style.setProperty('--brand', '#f60')` 修改。改一个变量，所有引用它的样式都会更新，适合主题色、拖拽位置这类需要 JS 驱动的样式。

### 暗色模式和主题切换

1. 定义语义化变量，比如 `--bg`、`--text`、`--border`，组件里只用变量，不写死颜色
2. `:root` 写浅色值，`[data-theme="dark"]` 覆盖成深色值
3. 用户没有手动选择时，用 `@media (prefers-color-scheme: dark)` 跟随系统
4. 用户手动切换后，把选择存到 `localStorage`，在 `html` 上设置 `data-theme`
5. 在 `head` 里内联一小段同步脚本，在页面绘制前读出偏好并设置属性，避免先闪一下浅色

`color-scheme` 属性告诉浏览器页面支持哪些配色，浏览器会让滚动条、表单控件、默认背景色也切成暗色。写成 `light dark` 时浏览器跟随系统选，用户手动切换主题后，要把它改成对应的单一值，否则系统是浅色时控件仍是浅色。

## 代码示例

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --text: #1f2328;
}

/* 用户手动选择暗色；color-scheme 也要跟着改，表单控件、滚动条才会同步 */
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0d1117;
  --text: #e6edf3;
}

:root[data-theme="light"] {
  color-scheme: light;
}

/* 没有手动选择浅色时，跟随系统 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d1117;
    --text: #e6edf3;
  }
}

body {
  background: var(--bg);
  color: var(--text);
}
```

```html
<head>
  <!-- 同步执行，在首次绘制前设置好主题 -->
  <script>
    try {
      const theme = localStorage.getItem('theme')
      if (theme) document.documentElement.dataset.theme = theme
    } catch (e) {}
  </script>
</head>
```

## 面试官可能追问

::: details CSS 变量能做过渡动画吗？@property 是什么？
普通自定义属性浏览器不知道它的类型，只能当作字符串离散切换，没有中间帧。用 `@property` 注册类型后就可以插值，比如注册一个 `<angle>` 类型的 `--angle`，就能让渐变的角度平滑旋转：

```css
@property --angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
```

注册还能顺便关闭继承、指定初始值，避免变量被意外继承。
:::

::: details 系统主题变了，JS 怎么知道？
用 `window.matchMedia('(prefers-color-scheme: dark)')` 拿到查询对象，读 `matches` 判断当前是否暗色，监听它的 `change` 事件响应系统切换。如果主题完全由 CSS 变量和媒体查询驱动，JS 不需要介入；只有 canvas 图表这类不读 CSS 的内容才需要手动处理。
:::

::: details SSR 项目怎么避免主题闪烁？
服务端不知道 `localStorage`，所以要么把用户的选择存到 cookie，服务端渲染时直接输出带 `data-theme` 的 `html`；要么像上面一样在 `head` 里放同步内联脚本。两种方法的关键都是在首次绘制前确定主题，放在 `onMounted` 之类的钩子里就太晚了。
:::

## 易错点

- `var()` 的回退值只在变量未定义时生效，变量值对属性不合法时不会使用回退值，属性会按 `unset` 处理
- CSS 变量不能用在媒体查询的条件里，`@media (min-width: var(--bp))` 不生效
- 主题脚本写在 `body` 末尾或异步加载都会闪烁，必须在 `head` 里同步执行
