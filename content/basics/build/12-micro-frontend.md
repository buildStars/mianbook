---
difficulty: 3
tags: [原理, 对比, 场景题]
---

# 微前端是什么？有哪些实现方案？

::: tip 一句话回答
微前端把一个大型前端应用拆成多个可以**独立开发、独立部署**的子应用，由一个**主应用（基座）**在运行时组合起来。它解决的是组织问题：多团队并行、技术栈不同、老项目**渐进迁移**。常见方案有 **iframe**（隔离最彻底，体验差）、**single-spa / qiankun**（按路由加载子应用，qiankun 补上了 JS 沙箱和样式隔离）、**Module Federation**（构建工具层面在运行时共享模块）、**Web Components**（用自定义元素封装子应用）。难点集中在**隔离、共享依赖、通信和路由**。团队小、技术栈统一的项目不需要微前端。
:::

## 详细解析

### 解决什么问题，什么时候不该用

适合的场景：

- **巨石应用**：几十个模块堆在一个仓库，构建慢，一个模块出问题整体无法发版
- **多团队协作**：各团队希望独立迭代、独立上线，互不阻塞
- **技术栈不同或渐进迁移**：老系统是 jQuery 或 AngularJS，新功能想用 Vue、React 写，又不能一次性重写

不该用的情况：一两个团队、技术栈统一、发布节奏一致。这时用 monorepo 加按路由的代码分割就能满足需求（见 [monorepo](/basics/build/11-monorepo)），微前端带来的运行时开销、调试成本和基础设施投入得不偿失。

### iframe

浏览器原生的隔离：JS、CSS、全局变量完全独立，子应用几乎不需要改造。问题在体验上：

- 子应用的路由状态不在主应用 URL 里，刷新或分享链接后丢失
- 弹窗只能在 iframe 内部居中，无法覆盖整个页面
- 每次进入都要重新加载资源，主应用和子应用之间只能用 `postMessage` 通信，登录态在跨域时也会受限

适合嵌入第三方页面、对隔离要求极高、对体验要求不高的后台系统。

### single-spa 和 qiankun

single-spa 定义了子应用的生命周期（`bootstrap`、`mount`、`unmount`）和按路由激活子应用的机制，但不管资源加载和隔离。qiankun 在它的基础上补齐了这些能力：

1. **HTML Entry**：注册子应用时只提供一个 HTML 地址，qiankun 请求这个 HTML，解析出其中的 JS 和 CSS 并加载执行，子应用不需要改成单个 JS 入口
2. **JS 沙箱**：
   - **快照沙箱**：子应用激活时记录 `window` 上属性的快照，卸载时对比差异并还原。实现简单，但同一时间只能运行一个子应用，用于不支持 Proxy 的浏览器
   - **Proxy 沙箱**：为每个子应用创建一个假的 `window`，用 Proxy 拦截读写，写操作只落到自己的假对象上，读不到时再去真实的 `window` 上取，可以多个子应用同时运行
3. **样式隔离**：默认在子应用卸载时移除它的样式，只能保证单实例场景下子应用之间不冲突，主应用和子应用之间、多实例同时运行时都不隔离；`strictStyleIsolation` 用 Shadow DOM 把子应用包起来，`experimentalStyleIsolation` 改写子应用的 CSS 选择器，加上带子应用名的前缀

沙箱不是真正的安全边界：它防的是子应用之间互相污染全局变量，挡不住有意的逃逸。

### Module Federation

webpack 5 内置的 `ModuleFederationPlugin`，Rspack 也支持。每个应用可以把自己的模块**暴露**（exposes）出去，也可以在运行时**消费**（remotes）别的应用暴露的模块，还能声明**共享依赖**（shared），让 React、Vue 这类库在多个应用之间只加载一份。

它是"模块级"的共享，而不是"应用级"的组合，没有沙箱和样式隔离，更适合技术栈统一、需要跨应用复用组件和逻辑的场景。Module Federation 2.0（`@module-federation/enhanced`）在此基础上增加了独立的运行时、manifest 和类型提示，支持 webpack 和 Rspack。

### Web Components

把子应用包装成自定义元素，主应用像使用普通标签一样插入它，Shadow DOM 天然隔离样式。缺点是 JS 仍然共享全局，需要自己处理隔离；部分组件库的弹窗会挂到 `document.body` 上，跑出 Shadow DOM 后样式就失效了。也有开源框架基于这个思路实现，例如 micro-app 用自定义元素承载子应用，wujie 把 Web Components 和 iframe 结合起来使用。

### 方案对比

| | iframe | qiankun | Module Federation | Web Components |
| --- | --- | --- | --- | --- |
| JS 隔离 | 完全隔离 | Proxy / 快照沙箱 | 无 | 无 |
| 样式隔离 | 完全隔离 | Shadow DOM 或选择器前缀 | 无，靠规范约束 | Shadow DOM |
| 技术栈 | 任意 | 任意 | 需要用支持它的构建工具 | 任意 |
| 共享依赖 | 不能 | 需要自己处理，例如 externals | 原生支持 `shared` | 需要自己处理 |
| 改造成本 | 很低 | 子应用导出生命周期、调整构建配置 | 修改构建配置 | 封装成自定义元素 |

### 共享依赖、通信和路由

- **共享依赖**：每个子应用都打包一份 Vue 或 React，体积和内存都会翻倍；共享又要面对版本冲突。Module Federation 的 `singleton`、`requiredVersion` 就是为此设计的
- **通信**：保持最少。主应用通过 props 下发用户信息、权限等数据，子应用之间用事件总线或主应用提供的全局状态（qiankun 的 `initGlobalState`）通信，避免子应用之间直接互相依赖
- **路由**：主应用负责一级路由，决定加载哪个子应用；子应用负责自己的二级路由，需要设置和激活规则一致的 base 路径。两边都监听 URL 变化，容易出现重复跳转（路由原理见 [前端路由](/basics/browser/18-frontend-routing)）

## 代码示例

Module Federation：remote 暴露模块，host 在运行时加载（webpack 配置）：

```js
// remote/webpack.config.js
const { ModuleFederationPlugin } = require('webpack').container

module.exports = {
  output: { publicPath: 'http://localhost:4601/' },
  plugins: [
    new ModuleFederationPlugin({
      name: 'remoteApp',
      filename: 'remoteEntry.js', // 对外的入口文件
      exposes: { './greet': './src/greet.js' },
      shared: { dayjs: { singleton: true, requiredVersion: '^1.11.0' } },
    }),
  ],
}

// host/webpack.config.js 的 plugins 中
new ModuleFederationPlugin({
  name: 'host',
  remotes: { remoteApp: 'remoteApp@http://localhost:4601/remoteEntry.js' },
  shared: { dayjs: { singleton: true, requiredVersion: '^1.11.0' } },
})
```

```js
// host/src/index.js：入口只做一次动态导入，留出异步边界，让共享依赖先完成协商
import('./bootstrap.js')

// host/src/bootstrap.js
import { greet } from 'remoteApp/greet'
document.body.textContent = greet('host')
```

## 面试官可能追问

::: details qiankun 的子应用需要做哪些改造？
入口文件导出 `bootstrap`、`mount`、`unmount` 三个生命周期函数，`mount` 时渲染到主应用传入的容器里，`unmount` 时销毁实例。构建配置要把输出改成 UMD 格式，并设置一个唯一的 `library` 名称。子应用的静态资源会被主应用跨域请求，服务器要配置 CORS。资源的公共路径也要处理，否则子应用的懒加载 chunk 会去主应用的域名下请求。
:::

::: details 子应用之间的样式还是互相影响了，可能是什么原因？
常见原因有：子应用的弹窗、下拉框挂载到了 `document.body`，跑出了隔离范围；全局样式（reset、组件库主题）直接作用于 `html`、`body`；开启 Shadow DOM 后，组件库的弹层又找不到样式。实践中常用"约定加工具"的方式处理：每个子应用的样式加上统一前缀，组件库配置不同的类名前缀，弹层挂载到子应用自己的容器上。
:::

::: details 怎么从一个老系统渐进迁移到新技术栈？
用老系统或一个很薄的新壳作为主应用，按路由把功能一块块迁移到新的子应用中。每迁移一块，就把对应路由的流量切到新子应用，老代码保留到稳定后再删除。共享的登录态、权限和公共组件先抽出来，避免两边各维护一份。迁移完成后，如果团队和技术栈都统一了，可以考虑去掉微前端，退回到普通的单应用。
:::

## 易错点

- 把微前端当作性能优化手段：它主要解决组织和部署问题，运行时反而多了加载和沙箱开销
- 以为 Module Federation 自带 JS 沙箱和样式隔离，实际上它只负责模块共享
- 共享依赖没有设置 `singleton`，React 被加载两份，Hooks 报错或者 Context 失效
- 子应用之间直接互相调用、共享状态，拆分后的耦合比拆分前还重
