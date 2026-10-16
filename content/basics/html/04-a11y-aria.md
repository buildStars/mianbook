---
difficulty: 2
tags: [实践, 原理]
---

# 什么是 Web 可访问性？ARIA 应该怎么用？

::: tip 一句话回答
可访问性（a11y）是让**残障人士和各种受限场景下的用户**都能使用网页：看不见屏幕的人用屏幕阅读器，手不方便的人只用键盘，色弱用户分辨不了颜色。标准是 WCAG，核心是四个原则：**可感知、可操作、可理解、健壮**。ARIA 用来补充原生 HTML 表达不了的语义，**第一条规则是能用原生元素就不要用 ARIA**；ARIA 只改变辅助技术读到的信息，不会自动带来键盘行为，焦点和按键要自己实现。
:::

## 详细解析

### 为谁服务

- 视障用户用读屏软件（NVDA、VoiceOver、TalkBack 等）听页面，或者把页面放大很多倍；运动障碍用户只用键盘、开关设备或语音控制
- 听障用户需要视频字幕；认知障碍用户需要清晰的文案和一致的交互
- 临时或情境受限：手臂受伤、强光下看手机、老年人视力下降。可访问性做得好，所有人都受益

### WCAG 的四个原则

| 原则 | 含义 | 例子 |
| --- | --- | --- |
| 可感知 | 信息能被感知到，不只依赖一种感官 | 图片有 `alt`，视频有字幕，文字对比度足够，状态不只用颜色表示 |
| 可操作 | 能用各种方式操作 | 所有功能都能用键盘完成，焦点清晰可见，不设过短的时限 |
| 可理解 | 内容和交互容易理解 | 设置 `lang`，表单错误有明确提示，相同组件行为一致 |
| 健壮 | 能被浏览器和辅助技术可靠解析 | 合法的 HTML，自定义组件有正确的角色、名称和状态 |

WCAG 分 A、AA、AAA 三级，一般以 AA 为目标。比如 AA 级要求普通文字和背景的**对比度至少 4.5:1**，大号文字至少 3:1。

### ARIA 的使用规则

1. 能用原生元素就用原生元素：`<button>` 而不是 `<div role="button">`，原生元素自带聚焦、键盘和表单行为
2. 不要随意改变原生语义，比如不要把 `<h2>` 改成 `role="button"`，应该在标题里放一个按钮
3. 所有可交互的 ARIA 控件都必须能用键盘操作；也不要给可聚焦的元素加 `aria-hidden="true"` 或 `role="presentation"`

| 属性 | 作用 | 例子 |
| --- | --- | --- |
| `role` | 声明元素是什么 | `role="dialog"`、`role="tablist"`、`role="alert"` |
| `aria-label` | 直接提供可访问名称 | 只有图标的按钮：`aria-label="关闭"` |
| `aria-labelledby` | 用页面上其他元素的文字作为名称 | 弹窗指向自己标题的 id |
| `aria-describedby` | 补充描述信息 | 输入框关联格式说明或错误提示 |
| `aria-expanded` | 展开或收起的状态 | 折叠面板、下拉菜单的触发按钮 |
| `aria-live` | 内容变化时主动播报 | `polite` 等读屏空闲时播报，`assertive` 立即打断 |

### 焦点和键盘

- `tabindex="0"`：让本来不能聚焦的元素按 DOM 顺序进入 Tab 序列
- `tabindex="-1"`：不进入 Tab 序列，但可以用 `el.focus()` 聚焦，用于弹窗容器、跳转目标、组件内部的非当前项
- **不要用正数 tabindex**：它会让元素排到所有元素前面，Tab 顺序和视觉顺序脱节，很难维护
- 常见按键约定：Tab / Shift+Tab 在控件之间移动；Enter 激活链接和按钮；Space 激活按钮、勾选复选框；Esc 关闭弹窗和菜单；方向键在菜单、标签页、单选组、列表内部移动
- 焦点要可见，也要管理：不要只写 `outline: none`，可以用 `:focus-visible` 只给键盘操作显示焦点框；打开弹窗时把焦点移进去，关闭后回到触发按钮；单页应用切换路由后，把焦点移到新页面的标题上

### 检查工具

- 自动检查：Lighthouse 的无障碍评分、axe（浏览器插件，也能接入单元测试和端到端测试）、DevTools 的 Accessibility 面板查看可访问性树和对比度。它们只能发现一部分问题（缺 `alt`、对比度不足、表单没有标签等）
- 人工检查：拔掉鼠标只用键盘走一遍主流程；打开 VoiceOver 或 NVDA 实际听一遍；把页面放大到 200% 看布局有没有坏

## 代码示例

自定义下拉框（只能选、不能输入），参考 WAI-ARIA 编写指南里的 combobox 模式。能用原生 `<select>` 时优先用原生。

```html
<span id="fruit-label">水果</span>
<div id="fruit" role="combobox" tabindex="0" aria-labelledby="fruit-label"
     aria-controls="fruit-list" aria-expanded="false">苹果</div>
<ul id="fruit-list" role="listbox" aria-labelledby="fruit-label" hidden>
  <li id="fruit-0" role="option">苹果</li>
  <li id="fruit-1" role="option">香蕉</li>
  <li id="fruit-2" role="option">橙子</li>
</ul>
```

```js
const box = document.getElementById('fruit')
const list = document.getElementById('fruit-list')
const options = [...list.querySelectorAll('[role="option"]')]
let value = 0 // 已选中的项
let active = 0 // 展开时高亮的项

function setOpen(open) {
  list.hidden = !open
  box.setAttribute('aria-expanded', String(open))
  if (open) highlight(value)
  else box.removeAttribute('aria-activedescendant')
}

function highlight(i) {
  active = Math.max(0, Math.min(i, options.length - 1))
  options.forEach((o, idx) => o.setAttribute('aria-selected', String(idx === active)))
  // 焦点始终留在 combobox 上，用 aria-activedescendant 告诉读屏当前高亮的是哪一项
  box.setAttribute('aria-activedescendant', options[active].id)
}

function choose(i) {
  value = i
  box.textContent = options[i].textContent
  setOpen(false)
}

box.addEventListener('keydown', (e) => {
  const open = box.getAttribute('aria-expanded') === 'true'
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault() // 阻止页面滚动
    if (!open) setOpen(true)
    else highlight(active + (e.key === 'ArrowDown' ? 1 : -1))
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    open ? choose(active) : setOpen(true)
  } else if (e.key === 'Escape' && open) {
    setOpen(false) // 关闭，保留原来的值
  }
})
box.addEventListener('click', () => setOpen(list.hidden))
box.addEventListener('blur', () => setOpen(false))
list.addEventListener('mousedown', (e) => e.preventDefault()) // 点选项时不让 combobox 失去焦点
options.forEach((o, i) => o.addEventListener('click', () => choose(i)))
```

## 面试官可能追问

::: details aria-label、aria-labelledby、aria-describedby 有什么区别？
前两个提供"名称"，读屏聚焦到元素时先读名称；`aria-describedby` 提供"描述"，读在名称和角色之后，适合放补充说明。名称的优先级是 `aria-labelledby` > `aria-label` > 原生的 `<label>` 或元素内容。`aria-label` 的文字在页面上看不到，也可能不会被浏览器的翻译功能翻译，页面上已经有可见文字时，优先用 `aria-labelledby` 引用它。
:::

::: details aria-hidden、display: none 和 inert 有什么区别？
`display: none` 对所有人隐藏，读屏也读不到。`aria-hidden="true"` 只对辅助技术隐藏，元素仍然可见、仍然能被 Tab 聚焦，用在纯装饰的图标上；里面有可聚焦元素就会出现"能聚焦但读不出来"的问题。`inert` 属性让整个子树不能点击、不能聚焦，也从可访问性树中移除，适合弹窗打开时禁用背景内容。
:::

::: details 动态更新的提示（比如"已保存"）怎么让读屏用户知道？
用 live region：页面加载时就放一个带 `aria-live="polite"`（或 `role="status"`）的空容器，之后把提示文字写进去，读屏会在空闲时播报。紧急的错误用 `role="alert"`，会立即打断播报。容器必须先存在于 DOM 中，再改它的内容；把容器和文字一起插入，很多读屏不会播报。
:::

## 易错点

- 给 `<div>` 加了 `role="button"` 就以为完事了，其实还要 `tabindex="0"` 和 Enter、Space 的键盘处理
- 只用颜色表示状态，比如只把错误的输入框标红，色弱用户看不出来，要同时配文字或图标
- 为了好看全局写 `outline: none`，键盘用户就不知道焦点在哪里了
- 以为 Lighthouse 满分就等于可访问，自动检查覆盖不了键盘流程、焦点管理和读屏体验
