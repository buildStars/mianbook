---
difficulty: 2
tags: [高频, 原理]
---

# 热更新（HMR）的原理是什么？

::: tip 一句话回答
HMR 的流程是：dev server **监听文件变化** → 只**重新编译**改动的模块 → 通过 **WebSocket** 通知浏览器 → 浏览器里的 HMR 运行时**拉取新模块** → 沿着依赖链**向上冒泡**，找到声明过 `module.hot.accept` / `import.meta.hot.accept` 的模块（**HMR 边界**），用新模块替换旧模块并执行回调。冒泡到入口都没人接受时，就**整页刷新**。日常开发中改组件能保留状态，是因为 Vue、React 的插件自动注入了 accept 逻辑，在替换时保留组件实例或 hooks 的状态。
:::

## 详细解析

### 整体流程

```text
 编辑器保存 utils.js
        │
        ▼
 dev server（监听文件）──► 重新编译 utils.js
        │ WebSocket 推送：有更新（webpack 发新的 hash，Vite 发更新的模块路径）
        ▼
 浏览器 HMR 运行时
        │ 拉取更新：webpack 请求 xxx.hot-update.json 和 xxx.hot-update.js
        │          Vite 直接 import('/src/xxx.js?t=时间戳')
        ▼
 从 utils.js 沿 importer 向上找 HMR 边界
        ├─ 找到：执行 dispose，替换模块，执行 accept 回调
        └─ 找不到（冒泡到入口）：location.reload() 整页刷新
```

### webpack 的实现

1. webpack-dev-server 以 watch 模式运行 webpack，产物放在内存里；文件变化后增量编译，除了正常产物，还生成两类更新文件：**manifest**（JSON，列出变化的 chunk 和被删除的模块）和**更新 chunk**（JS，包含变化模块的新代码），默认文件名是 `[runtime].[fullhash].hot-update.json` 和 `[id].[fullhash].hot-update.js`
2. 编译完成后，dev server 通过 WebSocket 把新的 hash 发给浏览器
3. 浏览器端的 HMR 运行时执行 `check`：请求 manifest，再加载需要的更新 chunk
4. 执行 `apply`：把变化的模块标记为失效，从它开始向上找 accept 处理函数，找到就替换并执行回调；冒泡到入口都没找到，本次更新失败。`devServer.hot: true` 时会退回整页刷新，`hot: 'only'` 则不刷新，保留页面让你看控制台报错

### Vite 的实现

Vite 开发时不打包，HMR 直接基于**模块图**：dev server 记录了每个模块被谁导入（importers）。文件变化后：

1. 找到变化文件对应的模块，沿 importers 向上找接受更新的边界
2. 通过 WebSocket 推送 `{ type: 'update', updates: [{ type: 'js-update', path, acceptedPath, timestamp }] }`，`path` 是边界模块，`acceptedPath` 是边界接受的那个模块（自接受时两者相同）
3. 浏览器用 `import('/src/xxx.js?t=时间戳')` 重新请求 `acceptedPath`，带时间戳是为了绕开浏览器的模块缓存，然后执行边界上注册的 accept 回调
4. 没有边界时推送 `{ type: 'full-reload' }`，修改 `index.html` 这类文件也是整页刷新

因为只需要重新编译变化的那个文件、更新只涉及到边界为止的一小段链路，Vite 的热更新速度基本不受项目规模影响。

### 框架插件如何保留组件状态

手写 accept 只能做到"替换模块"，状态保留靠框架插件：

- **Vue**：vue-loader 和 `@vitejs/plugin-vue` 在每个单文件组件里注入 accept 代码，借助 Vue 的 HMR 运行时按组件 id 更新所有实例。只改模板时**只重新渲染**，组件状态保留；改了 `script` 时会重新创建组件实例，组件内部状态丢失，Pinia 等外部 store 里的状态还在
- **React Fast Refresh**：插件（如 `@vitejs/plugin-react`）给组件注册签名。文件**只导出 React 组件**时，替换组件函数后用原来的 fiber 重新渲染，`useState` 等 hooks 的状态保留；hooks 的调用顺序或数量变了会重新挂载；类组件不保留状态；文件还导出了普通函数或常量时，这个文件不能作为边界，更新会冒泡到导入它的模块

## 代码示例

```js
// main.js（Vite）：接受 counter.js 的更新，用新模块重新挂载，同时保留计数
import { mount } from './counter.js'

let instance = mount(document.querySelector('#app'), 0)

if (import.meta.hot) {
  import.meta.hot.accept('./counter.js', (newModule) => {
    if (!newModule) return // 更新失败时为 undefined
    const count = instance.destroy() // 销毁旧实例，拿到当前状态
    instance = newModule.mount(document.querySelector('#app'), count)
  })
}

// webpack 中的等价写法：
// module.hot.accept('./counter.js', () => { /* 重新 import 并挂载 */ })
```

```js
// timer.js：自己接受自己的更新（自接受模块），并清理旧模块留下的副作用
const id = setInterval(() => console.log('tick'), 1000)

if (import.meta.hot) {
  import.meta.hot.dispose(() => clearInterval(id)) // 旧模块被替换前调用
  import.meta.hot.accept()
}
```

## 面试官可能追问

::: details 改了代码页面却整页刷新了，可能是什么原因？
最常见的是冒泡到入口都没有遇到 HMR 边界，比如改的是一个被 `main.js` 直接引入、又没有被任何组件接受的工具模块。React 项目里，组件文件同时导出了常量或工具函数，Fast Refresh 也会放弃把它作为边界。另外 Vite 中修改 `index.html`，或者更新链路上有循环依赖时，也可能触发整页刷新；改 `vite.config` 则会直接重启 dev server。
:::

::: details HMR 和 live reload 有什么区别？
live reload 是文件变化后直接刷新整个页面，页面状态全部丢失。HMR 在不刷新页面的前提下只替换变化的模块，配合框架插件还能保留组件状态。webpack-dev-server 在 HMR 失败时会退回 live reload。
:::

::: details 为什么 HMR 代码要放在 `if (import.meta.hot)` 里？
生产构建时 `import.meta.hot` 会被替换成 `undefined`，整个 if 块会被当作死代码删除，不会进入产物。webpack 中对应的是 `if (module.hot)`。
:::

::: details 热更新后出现重复的事件监听或定时器，是什么原因？
旧模块被替换时，它注册的事件、定时器、订阅不会自动清除，新模块执行时又注册了一份。需要在 `dispose` 回调里清理这些副作用，跨更新要保留的数据可以放在 `import.meta.hot.data`（webpack 是 `module.hot.data`）里传给新模块。
:::

## 易错点

- HMR 不是"重新执行整个应用"，只有边界及其下面变化的模块会重新执行，边界之上的模块状态保持不变
- WebSocket 只用来推送"有更新"的通知，新模块的代码是浏览器另外发 HTTP 请求拉取的
- 状态保留是框架插件的能力，不是 HMR 本身的能力；普通 JS 模块被替换后，模块内的变量都会重新初始化
- 通过代理、容器或远程开发访问 dev server 时，WebSocket 连不上就会表现为"热更新失效"，需要配置 HMR 的连接地址和端口
