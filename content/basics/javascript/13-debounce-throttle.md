---
difficulty: 1
tags: [高频, 手写题]
---

# 防抖和节流有什么区别？手写实现

::: tip 一句话回答
**防抖**是事件停止触发 n 毫秒后才执行，期间再次触发就重新计时，适合搜索框联想、窗口 resize 结束后再计算。**节流**是每 n 毫秒最多执行一次，适合滚动、拖拽、mousemove 这类持续触发的事件。两者都靠闭包保存定时器或上次执行的时间。
:::

## 详细解析

### 区别

| | 防抖（debounce） | 节流（throttle） |
| --- | --- | --- |
| 规则 | 停止触发 n 毫秒后执行，期间再触发就重新计时 | 每 n 毫秒最多执行一次 |
| 持续触发时 | 一直不执行，停下来后才执行一次 | 按固定间隔执行 |
| 适用场景 | 搜索框联想、resize 结束后再计算、输入校验 | 滚动、拖拽、mousemove、防止按钮被连续点击 |

### 手写防抖

要点：用 `apply` 保留 `this` 和参数；`immediate` 为 true 时，一轮连续触发的第一次立即执行；提供 `cancel` 方法。定时器保存在[闭包](/basics/javascript/02-closure)里，多次调用共享同一份状态。

```js
function debounce(fn, delay, immediate = false) {
  let timer = null
  function debounced(...args) {
    // 没有等待中的定时器，说明是新一轮触发的第一次
    const callNow = immediate && !timer
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      // 非 immediate 模式：停止触发 delay 毫秒后，用最后一次的参数执行
      if (!immediate) fn.apply(this, args)
    }, delay)
    if (callNow) fn.apply(this, args)
  }
  debounced.cancel = () => {
    clearTimeout(timer)
    timer = null
  }
  return debounced
}
```

### 手写节流

```js
// 时间戳版：第一次触发立即执行；停止触发后不会再补执行
function throttleByTime(fn, interval) {
  let last = 0
  return function (...args) {
    const now = Date.now()
    if (now - last >= interval) {
      last = now
      fn.apply(this, args)
    }
  }
}

// 定时器版：第一次触发要等 interval 才执行；停止触发后还会执行一次
function throttleByTimer(fn, interval) {
  let timer = null
  return function (...args) {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      fn.apply(this, args)
    }, interval)
  }
}
```

两种各有缺点：时间戳版会丢掉最后一次触发，定时器版的第一次响应要等一个间隔。实际中常把两者结合，首尾都执行：第一次立即响应，停止触发后再用最后一次的参数执行一次，保证拿到最终状态。

```js
function throttle(fn, interval) {
  let last = 0
  let timer = null
  return function (...args) {
    const remaining = interval - (Date.now() - last)
    clearTimeout(timer)
    if (remaining <= 0) {
      // 距离上次执行已满 interval：立即执行
      last = Date.now()
      fn.apply(this, args)
    } else {
      // 还没到时间：安排一次尾调用，每次触发都用最新的参数重新安排
      timer = setTimeout(() => {
        last = Date.now()
        fn.apply(this, args)
      }, remaining)
    }
  }
}
```

## 面试官可能追问

::: details 怎么用 requestAnimationFrame 做节流？
```js
function rafThrottle(fn) {
  let ticking = false
  return function (...args) {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      ticking = false
      fn.apply(this, args)
    })
  }
}
```

每一帧最多执行一次，频率跟随屏幕刷新率，不用自己指定间隔，适合滚动时更新元素位置、做动画这类和渲染相关的操作；页面在后台时 rAF 会暂停。它和 requestIdleCallback 的区别见 [requestAnimationFrame 和 requestIdleCallback](/basics/browser/14-raf-ric)。
:::

::: details 在 Vue / React 组件中使用防抖要注意什么？
- **只创建一次**：React 函数组件每次渲染都会重新执行，直接写 `const onSearch = debounce(...)` 每次都会得到新的防抖函数，防抖就失效了，要用 `useRef` 或 `useMemo` 保存。Vue 选项式 API 不要在 `methods` 里直接写 `debounce(...)`，否则所有组件实例共用同一个定时器，应该在 `created` 里为每个实例单独创建
- **卸载时取消**：组件卸载时调用 `cancel()`，否则定时器到点后仍会执行，可能去操作已经卸载的组件
- 防抖函数只创建一次，它闭包里拿到的 state 可能是旧值，React 中常用 `useRef` 保存最新的回调
:::

::: details lodash 的 debounce 和 throttle 有什么关系？
lodash 的 `debounce` 支持 `leading`、`trailing`、`maxWait` 三个选项。`maxWait` 规定最长等待时间：即使事件一直在触发，等待超过 `maxWait` 也要执行一次，这让防抖有了节流的效果。lodash 的 `throttle` 就是基于 `debounce` 实现的：把 `maxWait` 设成和 `wait` 一样的间隔，并默认开启 `leading` 和 `trailing`。
:::

## 易错点

- 防抖函数要创建一次、反复调用；每次触发都重新调用 `debounce(fn, 300)` 生成新函数，它们各自计时，起不到防抖的作用
- 定时器回调要用箭头函数，再通过 `apply` 传入 `this` 和参数，否则 `this` 和事件对象会丢失
- 防抖在持续触发时可能一直不执行；需要定期执行的场景用节流，或者给防抖加上 `maxWait`
