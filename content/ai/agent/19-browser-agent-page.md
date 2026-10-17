---
difficulty: 2
tags: [原理, 实践]
---

# 浏览器 Agent 怎么把网页喂给模型？DOM 怎么裁剪成可交互元素列表？

::: tip 一句话回答
原始 HTML 太长、噪声太多，不能直接塞给模型。常见做法是从 **DOM 或无障碍树**里只挑出**可见、可交互**的元素（按钮、链接、输入框等），给每个元素**编号**，连同角色、名称、当前值整理成一个紧凑列表；模型只需回答"点 [12]""在 [7] 输入 xxx"，执行器再按编号找回真实节点。配合**带编号标注的截图**，模型能同时用文字和视觉定位。
:::

## 详细解析

### 为什么不能直接给 HTML

一个普通的电商页面，HTML 动辄几十万字符，里面大半是样式类名、脚本、埋点、隐藏的模板和 SVG 路径。全部塞进去有三个问题：

- **放不下**：超出上下文，或者把预算全耗在一页上
- **找不准**：真正能操作的元素只有几十个，被淹没在噪声里
- **不好执行**：模型输出一个 CSS 选择器，很容易写错或在页面更新后失效

所以页面表示的目标是：让模型**看得懂有什么能操作**，并且**输出能被执行器准确还原**。

### 从 DOM 到元素列表

1. **选来源**：无障碍树（accessibility tree）天然带角色和可读名称，噪声少，是很好的起点；DOM 信息更全，可以补充 `href`、`placeholder`、`value` 等属性。很多实现两者结合
2. **过滤可交互**：保留 `a`、`button`、`input`、`select`、`textarea`、带 `role="button"` 等角色的节点、有点击监听或 `cursor: pointer` 的元素、`contenteditable` 区域
3. **去掉不可见**：`display: none`、`visibility: hidden`、尺寸为 0、在视口外很远、被别的元素完全盖住的，都去掉或单独标记
4. **压缩文本**：每个元素只保留角色、名称（可见文字或 `aria-label`）、关键属性和当前状态（是否选中、是否禁用），长文本截断
5. **编号并建映射**：给元素分配 `[1]`、`[2]`……执行器保存"编号 → 节点引用"，模型说点哪个编号就点哪个
6. **保留少量结构**：把元素按所在区域（导航、表单、弹窗）分组或缩进，模型能理解"这个输入框属于登录表单"

非交互的正文也不能全丢。任务可能是"读出订单金额"，所以通常会附带一段裁剪过的可见文本，或者让模型通过专门的"读取页面文本"工具按需获取。

### 截图上的编号标注

只看文字列表，模型分不清两个都叫"确定"的按钮哪个在弹窗里。常见做法是在截图上给每个可交互元素画框并标上同样的编号。这种做法借用了 Set-of-Mark 视觉提示的思路：原论文用分割模型把普通图片切成区域再叠加编号，浏览器 Agent 则直接用 DOM 提取出的元素边框来画框。模型看图找到目标，再用编号输出动作。文字列表负责精确，截图负责空间关系，两者互补。和纯坐标点击相比，编号让动作可校验：编号不存在就直接报错，不会点到空白处。两种感知方式的整体对比见 [Computer Use 是怎么工作的](/ai/tools/14-computer-use)。

### 难处理的部分

| 情况 | 问题 | 常见处理 |
| --- | --- | --- |
| iframe | 主文档里看不到内部节点；跨域 iframe 页面脚本也访问不了 | 通过浏览器自动化协议逐个 frame 提取，编号里记录所属 frame |
| Shadow DOM | `querySelectorAll` 不会进入 shadow root | 遍历时检查 `shadowRoot` 递归进入；closed 模式拿不到，只能依赖无障碍树或截图 |
| Canvas、图表、地图 | 内部没有 DOM 节点 | 退回截图加坐标点击，或找页面提供的其他入口 |
| 虚拟列表、懒加载 | 没滚到的内容不在 DOM 里 | 提供滚动动作，滚动后重新提取 |

每次动作之后页面可能变了，编号要**重新生成**，不能沿用上一轮的映射。

## 代码示例

用一棵简化的节点树演示过滤、编号和格式化（真实场景里节点来自浏览器）：

```js
const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea'])

function extract(root) {
  const items = []
  const refs = new Map() // 编号 -> 节点，执行器用它还原
  function walk(node) {
    if (!node.visible) return // 不可见的整棵子树跳过
    if (INTERACTIVE.has(node.tag) || node.role === 'button') {
      const id = items.length + 1
      refs.set(id, node)
      const name = (node.text || node.ariaLabel || node.placeholder || '').slice(0, 40)
      items.push(`[${id}] ${node.role || node.tag} "${name}"${node.disabled ? ' (disabled)' : ''}`)
    }
    for (const child of node.children || []) walk(child)
  }
  walk(root)
  return { text: items.join('\n'), refs }
}

const page = {
  tag: 'body', visible: true, children: [
    { tag: 'a', text: '首页', visible: true },
    { tag: 'div', visible: false, children: [{ tag: 'button', text: '隐藏的按钮', visible: true }] },
    { tag: 'input', placeholder: '搜索商品', visible: true },
    { tag: 'div', role: 'button', ariaLabel: '加入购物车', visible: true },
    { tag: 'button', text: '提交', visible: true, disabled: true },
  ],
}

const { text, refs } = extract(page)
console.log(text)
// [1] a "首页"
// [2] input "搜索商品"
// [3] button "加入购物车"
// [4] button "提交" (disabled)
console.log(refs.get(3).ariaLabel) // 加入购物车
```

## 面试官可能追问

::: details 无障碍树和 DOM 各有什么优缺点？
无障碍树是浏览器为读屏软件生成的，已经合并了语义，角色和名称清楚，体积小。缺点是依赖页面的无障碍质量，用 `div` 拼出来又没加 `role` 的按钮可能不出现。DOM 信息完整，但要自己判断可见性和可交互性。实际常常以一个为主、另一个补充。
:::

::: details 元素太多（比如几百个链接）怎么办？
优先保留视口内的元素，视口外的只给数量提示，让模型决定是否滚动；重复结构（列表里的每一行）可以折叠成"共 N 项，前几项是……"；也可以先让模型选区域，再展开该区域的元素。
:::

::: details 编号会不会和真实元素对不上？
会。页面在提取和执行之间发生了变化（异步加载、弹窗出现），旧编号就可能指向别的元素或失效。执行器要在动作前检查节点仍然存在、仍然可见，每次动作后重新提取。
:::

## 易错点

- 只过滤标签名，漏掉用 `div` 加点击事件做成的按钮，或者把隐藏的模板元素也列了进去
- 动作之后沿用上一轮的编号，页面已经变了，点到错误的元素
- 把整页正文全部丢掉，导致需要"读信息"的任务无从下手
- 忽略 iframe 和 Shadow DOM，表现为"页面上明明有，Agent 说找不到"
