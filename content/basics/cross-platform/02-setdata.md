---
difficulty: 2
tags: [性能优化, 实践]
---

# 小程序的 setData 为什么会卡？怎么优化？

::: tip 一句话回答
`setData` 要把数据从逻辑层**序列化后经 Native 传到渲染层**，渲染层再找出受影响的节点去更新页面，耗时取决于**传输的数据量、调用频率和组件的节点规模**。优化思路就是少传、少调、缩小更新范围：**只传变化的路径**（如 `'list[3].name'`）、合并多次调用、和渲染无关的数据不放进 `data`、长列表分页或做虚拟列表、把频繁更新的部分**拆成独立的自定义组件**，再用开发者工具的性能分析定位慢的那次更新。
:::

## 详细解析

### 一次 setData 经历了什么

1. 逻辑层修改 `this.data`，把这次传入的数据序列化
2. 通过 Native 转发给渲染层，这是一次跨线程通信（双线程架构见 [小程序的双线程架构](/basics/cross-platform/01-miniprogram-arch)）
3. 渲染层把数据应用到组件的模板上，找出需要更新的数据绑定，更新节点
4. 渲染完成后，执行 `setData` 的回调

所以卡顿有三个来源：**数据大**，序列化和传输慢；**调用频繁**，逻辑层一直忙，渲染层的消息排队，页面跟不上；**组件大**，官方文档指出更新耗时和组件内节点的总数显著相关，而且这一点比数据量影响更大。

### 少传：只传变化的部分

- **用数据路径**：改列表里的一项，写 `this.setData({ 'list[3].checked': true })`，不要把整个 `list` 重新传一遍。`this.setData(this.data)` 这种"全量刷新"是最典型的反面例子
- **和渲染无关的数据不放进 `data`**：接口原始数据、定时器 id、分页游标这类数据，直接挂在 `this` 上，例如 `this.rawList = []`。放进 `data` 不仅白白传输，还会触发多余的渲染计算
- **纯数据字段**：组件里需要配合 `observers` 监听、但不渲染的字段，可以用 `pureDataPattern` 声明为纯数据字段，它们只存在 `this.data` 里，不会传到渲染层
- **长列表**：分页加载，追加时只传新增的几项；数据特别多时做虚拟列表，只渲染可视区附近的节点，思路见 [长列表优化](/basics/browser/13-long-list)

### 少调：控制频率

- 同一个流程里连续多次 `setData`，合并成一次
- `onPageScroll`、`touchmove`、`scroll-view` 的滚动回调里不要每次都 `setData`，只在状态真正变化时更新，或者节流
- 页面切到后台（`onHide`）后停止倒计时、轮询等更新，回到前台再刷新。逻辑层只有一个线程，后台页面的更新会和前台页面抢资源

### 缩小范围：拆组件

更新只发生在调用 `setData` 的那个页面或组件内部。把频繁变化的部分（倒计时、点赞数、进度条）拆成独立的小组件，在组件内部 `setData`，每次只需要处理这个小组件的节点，大页面不用跟着重新计算。

## 代码示例

```js
Page({
  data: { list: [], showBackTop: false },

  onLoad() {
    this.rawList = [] // ✅ 和渲染无关的数据挂在 this 上
  },

  toggle(e) {
    const i = e.currentTarget.dataset.index
    // ❌ this.setData({ list: this.data.list }) 会把整个数组再传一遍
    // ✅ 只传变化的那个字段
    this.setData({ [`list[${i}].checked`]: !this.data.list[i].checked })
  },

  appendItems(items) {
    // ✅ 加载下一页：只传新增的几项
    const start = this.data.list.length
    const patch = {}
    items.forEach((item, k) => { patch[`list[${start + k}]`] = item })
    this.setData(patch)
  },

  onPageScroll({ scrollTop }) {
    const show = scrollTop > 600
    // ✅ 状态真的变了才通信，而不是滚动时一直 setData
    if (show !== this.data.showBackTop) this.setData({ showBackTop: show })
  },
})
```

连续的多次更新可以先攒起来，在微任务里合并成一次：

```js
function createBatchedSetData(page) {
  let pending = null
  return function setDataBatched(patch) {
    if (!pending) {
      pending = {}
      Promise.resolve().then(() => {
        const data = pending
        pending = null
        page.setData(data) // 同一轮同步代码里的调用只通信一次
      })
    }
    Object.assign(pending, patch)
  }
}
```

## 面试官可能追问

::: details 直接改 this.data 行不行？
不行。`this.data.count = 1` 只改了逻辑层的对象，渲染层不知道，页面不会更新，而且之后两边的数据还会不一致。必须通过 `setData` 修改需要渲染的数据。`setData` 调用后 `this.data` 会立即变成新值，不用等回调。
:::

::: details setData 的回调适合用来做什么？
回调在数据已经应用到渲染层之后执行，适合"等页面更新完再查询节点尺寸、滚动到某个位置"这类操作。官方提醒它的执行时机偏晚，滥用会影响性能，不要把每次 `setData` 都写成回调链。
:::

::: details 怎么找到是哪次 setData 慢？
开发者工具的性能分析和"体验评分"会提示过于频繁、数据过大的 `setData`；真机上要用真机调试看实际耗时。组件里还可以调用 `this.setUpdatePerformanceListener`，拿到每次更新排队、开始和结束的时间戳，传入 `withDataPaths: true` 还能拿到改动的数据路径，找出拖慢页面的组件。
:::

::: details 倒计时这种每秒都要更新的场景怎么写？
把倒计时做成独立的小组件，在组件内部更新，不要在一个大页面的 `data` 上每秒改一次。页面隐藏时清除定时器，显示时按当前时间重新计算剩余时间，不要依赖定时器累加，切后台回来后才不会出现时间不准。
:::

## 易错点

- 卡顿不只跟数据量有关，组件内的节点越多，每次更新的计算越重，所以拆组件往往比压缩数据更有效
- 用数据路径时 key 是字符串，动态下标要用计算属性名写成 `` [`list[${i}].name`] ``；写成 `'list[i].name'` 时，`i` 不会被替换成变量的值
- 把所有状态都塞进 `data` 是常见的坏习惯，只有模板里用到的字段才应该放进去
