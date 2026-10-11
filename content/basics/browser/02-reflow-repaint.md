---
difficulty: 2
tags: [高频, 性能优化]
---

# 回流（重排）和重绘有什么区别？怎么减少？

::: tip 一句话回答
**回流**是元素的几何属性（位置、尺寸）变了，浏览器要重新计算布局；**重绘**是外观（颜色、背景）变了但布局不变，只需要重新绘制。回流一定会引起重绘，重绘不一定回流。减少的思路是：批量修改样式、读写分离、动画尽量用 `transform` 和 `opacity`。
:::

## 详细解析

### 什么会触发回流

- 增删 DOM 节点，改变元素的尺寸、位置、边距、字号、内容
- 改变窗口大小
- **读取布局信息**：`offsetTop`、`offsetWidth`、`clientWidth`、`scrollTop`、`getBoundingClientRect()`、`getComputedStyle()` 等。为了返回准确的值，浏览器必须立刻完成布局计算

### 什么只触发重绘

`color`、`background`、`visibility`、`outline`、`box-shadow` 等只影响外观、不影响布局的属性。

### 浏览器的优化与"布局抖动"

浏览器会把多次样式修改攒起来，在下一帧统一计算布局。但一旦读取布局信息，就必须立刻计算，这叫**强制同步布局**。在循环里读写交替，会导致每次循环都触发一次布局，这就是**布局抖动**：

```js
// ❌ 读写交替：每次循环都要强制同步布局
for (const el of items) {
  el.style.width = box.offsetWidth + 'px'
}

// ✅ 先读后写：只布局一次
const width = box.offsetWidth
for (const el of items) {
  el.style.width = width + 'px'
}
```

### 优化手段

1. **合并样式修改**：切换 class，或者一次性设置 `cssText`，不要逐条修改 `style`
2. **读写分离**：先集中读取，再集中写入；也可以把写操作放进 `requestAnimationFrame`
3. **批量操作 DOM**：用 `DocumentFragment` 组装好再插入；或者先 `display: none`，改完再显示
4. **动画用 `transform` 和 `opacity`**：元素在独立的合成层上时，这两个属性的变化只需合成，不触发回流和重绘
5. **缩小影响范围**：复杂动画的元素用 `position: absolute/fixed` 脱离文档流

## 面试官可能追问

::: details 下面的代码会触发几次回流？
```js
const el = document.getElementById('box')
el.style.width = '100px'
el.style.height = '100px'
el.style.margin = '10px'
console.log(el.offsetWidth)
```

通常只有 **1 次**。前三次修改会被浏览器合并，读取 `offsetWidth` 时强制做一次同步布局。之后如果没有新的修改，下一帧渲染时不需要再次布局。
:::

::: details will-change 有什么用？要注意什么？
提前告诉浏览器元素将要发生变化，浏览器可以提前把它提升为独立的合成层，让动画更流畅。但每个合成层都要占用额外的内存（尤其是显存），不能滥用：只给真正要做动画的元素加，动画结束后移除。
:::

::: details 怎么用 Chrome DevTools 定位回流和重绘？
在 Performance 面板录制一段操作，紫色的 Layout 事件是回流，绿色的 Paint 事件是绘制；如果 Layout 带有"强制回流"的警告，说明存在强制同步布局。还可以在 Rendering 面板勾选 Paint flashing，高亮显示被重绘的区域。
:::

## 易错点

- **读取**布局属性也会触发回流，不只是修改
- `visibility: hidden` 只触发重绘，`display: none` 会触发回流
