---
difficulty: 1
tags: [实践]
---

# 工厂模式是什么？前端里怎么用？

::: tip 一句话回答
工厂模式把"创建哪个对象、怎么创建"封装起来，调用方只说要什么，不关心具体的类和构造细节，实现**创建和使用的分离**。**简单工厂**用一个函数根据参数返回不同的对象；**工厂方法**把"创建哪一种"交给扩展方决定，新增类型时不用修改原有代码；**抽象工厂**负责创建一整套相互配套的对象。前端常用它根据配置创建不同的表单控件或图表、根据运行环境选择存储的实现，`axios.create()`、`document.createElement()`、Vue 的 `createApp()` 也都是工厂函数。
:::

## 详细解析

### 为什么不直接 new

直接 `new` 时，调用方要知道具体的类名和构造参数。同样的创建逻辑散落在很多地方，想换一种实现、调整初始化参数，就得改所有调用处。工厂把这些集中到一处：

| | 直接 new | 工厂 |
| --- | --- | --- |
| 调用方需要知道 | 具体的类、构造参数 | 只需要类型名或配置 |
| 切换实现 | 修改每个调用处 | 只改工厂 |
| 能返回什么 | 只能是这个类的新实例 | 不同类的实例、缓存的实例、包装过的对象 |
| 代价 | 简单直接 | 多一层间接 |

### 简单工厂：按运行环境创建存储

调用方只认 `getItem`、`setItem`、`removeItem` 这一组接口，由工厂根据运行环境决定用哪种实现：

```js
// 内存版：接口和 localStorage 一致，用于 SSR、Node.js 或存储被禁用的情况
class MemoryStorage {
  #map = new Map()
  getItem(key) {
    return this.#map.get(key) ?? null
  }
  setItem(key, value) {
    this.#map.set(key, String(value))
  }
  removeItem(key) {
    this.#map.delete(key)
  }
}

function tryNativeStorage(name) {
  try {
    const storage = window[name] // 存储被禁用时，访问这个属性本身就可能抛错
    storage.setItem('__probe__', '1')
    storage.removeItem('__probe__')
    return storage
  } catch {
    return null
  }
}

export function createStorage(name = 'localStorage') {
  if (typeof window === 'undefined') return new MemoryStorage() // 服务端渲染或 Node.js 环境
  return tryNativeStorage(name) ?? new MemoryStorage()
}

const storage = createStorage()
storage.setItem('theme', 'dark')
console.log(storage.getItem('theme')) // dark
```

业务代码不再关心当前是浏览器还是服务端、存储是否可用。几种浏览器存储的区别见 [浏览器存储](/basics/browser/07-storage)。

### 工厂方法：新增类型不改工厂

简单工厂通常用 `switch` 分发，每加一种类型都要改工厂函数。工厂方法的核心是把"创建哪个具体对象"推迟给扩展方决定：经典写法是父类定义创建方法、由子类重写；JS 里更常见的是让每种类型**注册**自己的创建函数，效果相同。动态表单就是这样根据 JSON 配置创建控件的：

```js
const registry = new Map() // 控件类型 -> 创建函数

export function registerField(type, create) {
  registry.set(type, create)
}

export function createField(config) {
  const create = registry.get(config.type)
  if (!create) throw new Error(`未注册的控件类型：${config.type}`)
  return create(config)
}

// 每种控件在自己的模块里注册，工厂本身不用修改
registerField('input', (c) => ({ tag: 'input', label: c.label, placeholder: c.placeholder ?? '' }))
registerField('select', (c) => ({ tag: 'select', label: c.label, options: c.options }))

const fields = [
  { type: 'input', label: '姓名', placeholder: '请输入姓名' },
  { type: 'select', label: '城市', options: ['北京', '上海'] },
].map(createField)
```

在 Vue 里，同样的思路通常是一张"类型 → 组件"的映射表，再用 `<component :is="...">` 渲染。图表也一样：`createChart('line', el, data)` 按类型创建对应的图表，对外统一提供 `update`、`destroy` 方法，调用方不用关心底层用的是哪个图表库。

### 抽象工厂：创建一整套配套的对象

需要的不是一个对象，而是一组必须配套使用的对象时，用抽象工厂。比如同一套业务代码要运行在浏览器和小程序里：每个平台提供一个工厂，分别创建本平台的存储、请求和提示组件，业务代码只依赖这一组接口。切换平台时整组替换，不会出现"浏览器的存储配上小程序的请求"这样的混搭。UI 组件库的主题（一整套按钮、输入框、弹窗的样式）也是类似的思路。

## 面试官可能追问

::: details 工厂模式和策略模式有什么区别？
工厂模式是**创建型**模式，解决"创建哪个对象"；策略模式是**行为型**模式，解决"用哪个算法"。两者经常一起出现：工厂根据配置选出一个策略对象，调用方再执行它，见 [策略模式](/basics/design-pattern/04-strategy)。
:::

::: details 简单工厂违反开闭原则吗？
严格来说是的，每新增一种类型都要修改工厂里的 `switch`。类型少、变化不频繁时这不是问题，代码反而最直观。类型多、经常扩展，或者由插件、第三方提供时，改成注册表：新增类型只要注册，不用改工厂本身，见 [SOLID 设计原则](/basics/design-pattern/09-solid)。
:::

::: details JS 中工厂函数和 class 怎么选？
工厂函数可以返回不同类型的对象或缓存的实例，调用时不用 `new`，也不用担心 `this` 丢失，Vue 的组合式函数和各种 `createXxx` API 都属于这一类。class 的优势是方法放在原型上、被所有实例共享，可以用 `instanceof` 判断类型，还能继承。两者可以结合：用 class 实现具体的产品，用工厂函数决定创建哪一个。
:::

## 易错点

- 只有一种实现、构造也很简单时，不需要工厂，直接 `new` 更清楚
- 工厂返回的各种对象要遵守同一组接口，否则调用方还得判断具体类型，工厂就失去了意义
- 简单工厂的 `switch` 越来越长时，改用注册表
