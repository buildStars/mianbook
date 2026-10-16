---
difficulty: 2
tags: [实践, 原理]
---

# 水合不匹配是怎么产生的？怎么排查和避免？

::: tip 一句话回答
**水合**是客户端 JS 接管服务端渲染出的 HTML：用同样的组件再渲染一遍，和已有的 DOM 逐个对照并绑定事件，见 [SSR 和水合](/basics/vue/18-ssr-hydration)。两边结果对不上就是**水合不匹配**，根源是**服务端和客户端第一次渲染时的输入不一样**：当前时间、随机数、时区和语言环境不同；服务端读不到 `window`、`localStorage`，客户端第一次渲染就用了它们；不合法的 HTML 嵌套被浏览器自动纠正；浏览器插件改了 DOM。解决思路是让客户端的**第一次渲染**和服务端完全一致，只能在客户端确定的内容等挂载后再渲染。
:::

## 详细解析

### 不匹配的后果

框架在开发环境会报警告，然后尝试修复：Vue 会改写文本，或者丢掉对不上的节点重新创建；React 会放弃复用这一块服务端 HTML，改在客户端重新渲染，范围通常是最近的 Suspense 边界，没有就是整个根。代价是：

- 性能变差，这一块的 SSR 白做了
- 页面闪烁，先显示服务端的版本，再跳成客户端的版本
- 属性上的差异不保证会被修正，最坏的情况下事件会绑到错误的元素上

### 常见原因

1. **时间和随机数**：`new Date()`、`Math.random()`、模块里的自增 id 在两端各执行一次，结果必然不同
2. **时区和语言环境**：服务器在 UTC，用户在东八区，`toLocaleString()` 格式化出的日期就不一样；Node 和浏览器的默认语言、Intl 数据也可能不同
3. **只在浏览器存在的数据**：服务端没有 `window`、`localStorage`、`matchMedia`。渲染逻辑里用 `typeof window !== 'undefined'` 分支，比如从 localStorage 读主题、按窗口宽度判断是否移动端，客户端第一次渲染就和服务端不同
4. **依赖客户端状态的条件渲染**：登录状态只存在浏览器里，服务端渲染出"登录"按钮，客户端渲染出用户头像
5. **不合法的 HTML 嵌套**：浏览器解析 HTML 时会自动纠正结构。`<p>` 里放 `<div>`，解析器会提前结束 p；`<table>` 下直接写 `<tr>`，浏览器会补上 `<tbody>`；`<a>` 里再套 `<a>` 会被拆开。解析出的 DOM 和框架预期的对不上
6. **浏览器插件和第三方脚本**：翻译、广告拦截、密码管理插件会在水合前往页面里插入节点、添加属性

同一个时间点，时区不同，格式化结果就不同：

```js
const d = new Date(0)
console.log(d.toLocaleString('zh-CN', { timeZone: 'UTC' })) // 1970/1/1 00:00:00
console.log(d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })) // 1970/1/1 08:00:00
```

### 怎么避免

- **两端用同一份数据**：时间戳、随机数、接口数据只在服务端生成一次，随 HTML 序列化给客户端复用（如 Nuxt 的 useFetch、useState），客户端不要重新生成。需要唯一 id 时用框架提供的 `useId()`，两端生成的值一致
- **只能在客户端确定的内容，挂载后再渲染**：第一次渲染输出和服务端一样的内容，在 `onMounted`、`useEffect` 里读取客户端数据再更新。整块只在浏览器有意义的组件，用 Nuxt 的 `<ClientOnly>`，或者在 Next.js 的客户端组件里用 `dynamic(() => import(...), { ssr: false })`
- **时间显式指定时区和语言**：如 `new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' })`；"3 分钟前"这类相对时间挂载后再计算
- **写合法的 HTML**：块级元素不放进 `<p>`，表格写全 `<tbody>`，链接、按钮不互相嵌套
- **个性化内容在服务端就拿到数据**：登录态放在 Cookie 里，服务端渲染时就能读到，比"服务端渲染未登录、客户端再切换"既不闪烁也不会不匹配，见 [SSR 的登录态](/basics/ssr/10-ssr-auth)

```vue
<script setup>
import { ref, onMounted } from 'vue'

// ❌ 服务端读不到 localStorage，两端第一次渲染结果不同
// const theme = ref(typeof window !== 'undefined' ? localStorage.getItem('theme') : 'light')

// ✅ 第一次渲染和服务端一致，挂载后再读客户端数据
const theme = ref('light')
onMounted(() => {
  theme.value = localStorage.getItem('theme') ?? 'light'
})
</script>

<template>
  <div :class="theme">...</div>
</template>
```

### React 的 suppressHydrationWarning

某个元素的文本或属性**确实无法避免**地不同，比如显示服务端生成页面时的时间戳，可以给这个元素加上 `suppressHydrationWarning`。它只作用于这一层元素，而且只是不报警告，React 不会去修正不一致的文本，不能拿它掩盖逻辑问题。Vue 里对应的是 `data-allow-mismatch` 属性。

```jsx
<time suppressHydrationWarning>{new Date().toLocaleTimeString()}</time>
```

### 排查方法

1. 在开发环境复现：React 和 Vue 都会在控制台指出不匹配的节点和两边的内容，生产环境默认只有一句笼统的报错
2. 对比"查看网页源代码"（服务端返回的原始 HTML）和 Elements 面板（浏览器解析、水合后的 DOM），HTML 被自动纠正、插件插入的节点都能这样看出来
3. 用无痕模式或者关掉插件再试，排除插件干扰
4. 还定位不到就二分：把可疑组件临时包进 `<ClientOnly>` 或改成挂载后渲染，看警告是否消失
5. 检查生产服务器的时区和语言环境；上线后用 React 的 `onRecoverableError` 或前端监控上报水合错误

## 面试官可能追问

::: details 深色模式怎么做到既不闪烁又不报水合不匹配？
主题只存在 localStorage 里时，服务端不知道用户选了什么，只能先渲染默认主题，挂载后再切换，页面会闪一下。两种做法：把主题存进 Cookie，服务端渲染时就输出正确的 class；或者在 `<head>` 里放一段同步执行的内联脚本，在页面渲染前给 `<html>` 加上主题 class。后者改了框架管理的元素属性，React 项目要在 `<html>` 上加 `suppressHydrationWarning`。
:::

::: details 为什么用 typeof window 判断解决不了问题？
它只解决了"服务端访问 window 会报错"，却让两端渲染出了不同的内容，正好制造了不匹配。判断运行环境、读取浏览器数据的代码应该放在只在客户端执行的地方：`onMounted`、`useEffect` 或事件回调里，而不是渲染逻辑里。
:::

::: details useId 解决了什么问题？
SSR 时组件常常需要唯一 id，比如 label 的 for 要对应 input 的 id。用自增计数器或随机数，两端生成的值不同；计数器放在模块顶层，服务端的多个请求还会共用它，数字越来越大。React 和 Vue 的 `useId()` 保证同一个组件在服务端和客户端生成相同的 id。
:::

::: details 服务端渲染后、水合前数据更新了，会不匹配吗？
只要客户端水合时用的是**随 HTML 一起下发的那份数据**，就不会。这正是 Nuxt 的 useFetch、Next.js 的服务端组件要把数据序列化进页面的原因。如果客户端在水合前又请求了一次接口，拿到了更新后的数据，就会不匹配，见 [Nuxt 的数据获取](/basics/ssr/07-nuxt-data-fetching)。
:::

## 易错点

- 在渲染逻辑里写 `typeof window !== 'undefined'` 分支，是导致不匹配最常见的写法
- `suppressHydrationWarning` 只关闭警告、只管一层，React 不会帮你修正内容
- 本机测试没问题不代表线上没问题：生产服务器的时区、语言环境可能和本机不同
- 插件导致的不匹配被当成代码问题排查半天，先用无痕模式确认
