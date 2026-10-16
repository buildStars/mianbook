---
difficulty: 3
tags: [原理]
---

# React Native 的架构是怎样的？新架构解决了什么问题？

::: tip 一句话回答
React Native 用 JS 写 React 组件，最终渲染成**真正的原生视图**。旧架构里，JS 和原生之间靠一座**异步的 Bridge** 传递序列化成 JSON 的消息，数据量大、更新频繁时序列化成了瓶颈，也做不到同步调用。新架构用 **JSI** 替换了 Bridge，让 JS 能直接持有 C++ 对象的引用、同步调用方法；在此之上，**Fabric** 是新的渲染系统，支持同步读取布局和 React 的并发特性；**TurboModules** 是新的原生模块系统，默认按需加载；**Codegen** 根据带类型的 JS 接口声明生成原生侧的胶水代码，保证两边类型一致。
:::

## 详细解析

### 旧架构：靠 Bridge 异步通信

```text
JS 线程（React、业务代码）
      │  序列化成 JSON，放进消息队列，批量异步发送
      ▼
   Bridge
      │  反序列化，交给对应的原生模块或视图管理器
      ▼
原生侧：用 Yoga 计算布局 → UI 主线程创建和更新原生视图
```

JS 调原生模块、渲染一个 `View`，都要把调用序列化后排进队列，原生侧再异步处理，结果通过回调传回来。问题集中在几处：

- **序列化开销**：每次跨边界都要编码、解码一遍，频繁更新或传大对象时很容易成为瓶颈，动画和手势难以稳定流畅
- **只能异步**：JS 拿不到"此刻"的布局信息，在 `onLayout` 回调里测量再更新状态，用户可能先看到一帧错误的位置，出现跳动
- **启动慢**：原生模块在启动时就要初始化并注册，模块越多启动越慢
- **没有类型约束**：JS 和原生两边的接口靠约定对齐，参数类型写错要到运行时才发现

### 新架构的四个部分

| 组成 | 作用 |
| --- | --- |
| JSI（JavaScript Interface） | 一层轻量的 C++ 接口。JS 可以持有 C++ 对象的引用，C++ 也能持有 JS 对象，直接调用方法，不需要序列化 |
| Fabric | 新的渲染系统，核心用 C++ 实现、各平台共享。视图层级保存在不可变的树结构里，可以线程安全地处理更新，能同步测量和渲染 |
| TurboModules | 新的原生模块系统，通过 JSI 同步或异步调用原生能力，模块在真正用到时才加载 |
| Codegen | 读取用 TypeScript 或 Flow 写的接口声明，在构建时生成 C++ 胶水代码和各平台的原生代码，两边类型不一致会在构建时暴露 |

### 新架构带来的变化

- **同步布局**：可以在 `useLayoutEffect` 里同步测量元素并更新状态，测量和更新在同一次提交里完成，用户看不到中间状态
- **支持并发特性**：Fabric 支持 React 的并发渲染，`Suspense`、`startTransition` 等能力可以在 React Native 里使用，高优先级的交互可以打断低优先级的渲染
- **调用更直接**：原生方法可以同步返回值，返回值甚至可以是原生对象的引用，大块数据（如图像帧）不用来回拷贝
- **启动更快**：原生模块懒加载，应用功能越多，收益越明显
- **事件循环向 Web 看齐**：JS 线程上的任务按明确定义的顺序执行，紧急的用户事件可以插队；模型参照 HTML 规范，为微任务、`MutationObserver` 这类浏览器特性打下基础

### Hermes 引擎

**Hermes** 是 React Native 默认使用的 JS 引擎，在构建发布包时就把 JS 预编译成字节码，设备上不用再解析源码，对启动速度、内存占用和包体积都有帮助。

## 代码示例

TurboModule 的接口声明，Codegen 根据它生成原生侧的接口（原生实现各端写法不同，这里省略）：

```ts
// specs/NativeLocalStorage.ts
import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export interface Spec extends TurboModule {
  setItem(value: string, key: string): void
  getItem(key: string): string | null // 同步返回，不需要回调
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeLocalStorage')
```

```tsx
import NativeLocalStorage from './specs/NativeLocalStorage'

// 旧架构的原生模块一般通过回调或 Promise 异步返回：getItem(key, (value) => { ... })
// 新架构可以同步拿到返回值
const saved = NativeLocalStorage.getItem('theme')
```

## 面试官可能追问

::: details 新架构下 Bridge 彻底没了吗？老的原生库还能用吗？
新架构本身不再依赖 Bridge，JS 和原生通过 JSI 直接通信。为了让生态逐步迁移，官方保留了兼容层，很多按旧方式写的原生模块和组件仍然可以在新架构下运行。但要用上同步调用和类型检查，库作者需要按 TurboModule 和 Fabric 组件的方式重写接口声明。
:::

::: details JSI 和 Bridge 的本质区别是什么？
Bridge 是"发消息"：两边各自持有数据，通信时把数据序列化成字符串传过去，只能异步。JSI 是"直接引用"：JS 引擎通过 C++ 接口暴露对象，JS 拿到的是对原生对象的引用，调用方法就是一次函数调用，可以同步、也不用拷贝数据。JSI 也不绑定某个引擎，Hermes、JavaScriptCore 都可以接入。
:::

::: details React Native 的界面为什么会卡？新架构能解决所有卡顿吗？
不能。常见的卡顿来自 JS 线程太忙：大量重渲染、长列表没有优化、在 JS 里逐帧驱动动画。新架构降低了通信成本，但 JS 线程的工作量还在。优化手段仍然是减少不必要的渲染（`memo`、拆分状态）、长列表用虚拟化列表、动画尽量交给原生线程执行，并用性能分析工具找出热点。
:::

## 易错点

- React Native 渲染的是原生组件，不是 WebView，`View` 在 Android 上对应的是原生的 `ViewGroup`
- JSI 是新架构的基础，Fabric 和 TurboModules 都建立在它之上，不要把四个部分说成并列的独立优化
- Hermes 是 JS 引擎，和新架构是两件事：旧架构也能用 Hermes，Hermes 本身不等于新架构
