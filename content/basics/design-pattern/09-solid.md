---
difficulty: 2
tags: [原理, 实践]
---

# SOLID 设计原则分别是什么？

::: tip 一句话回答
SOLID 是五条设计原则的首字母：**单一职责**（一个模块只因一种原因而修改）、**开闭**（对扩展开放、对修改关闭）、**里氏替换**（子类型能替换父类型而不破坏程序）、**接口隔离**（不强迫使用方依赖它用不到的东西）、**依赖倒置**（高层模块依赖抽象，而不是具体实现）。它们的共同目标是让需求变化时改动范围小、影响可控。这些是经验法则而不是硬性规定：规模小、变化少的代码过早抽象，反而会增加理解和维护的成本。
:::

## 详细解析

### S：单一职责原则

一个模块只应该因为一种原因而修改。"原因"指变化的来源，比如接口格式、统计规则、界面展示，往往由不同的人、在不同的时间提出修改。Vue 组件也一样：数据请求和业务计算抽到组合式函数里，组件只负责展示。

```js
// 改造前：一个函数既请求数据、又计算、又操作 DOM，三种需求变化都要改它
async function renderOrderTotal() {
  const orders = await fetch('/api/orders').then((res) => res.json())
  const total = orders.reduce((sum, order) => sum + order.amount, 0)
  document.querySelector('#total').textContent = `合计：${total}`
}
// 改造后：三件事分开，统计逻辑成了纯函数，可以直接写单元测试
const fetchOrders = () => fetch('/api/orders').then((res) => res.json())
const sumAmount = (orders) => orders.reduce((sum, order) => sum + order.amount, 0)
const renderTotal = (el, total) => { el.textContent = `合计：${total}` }
```

### O：开闭原则

新增功能时，尽量通过增加代码来实现，而不是修改已经稳定的代码。Vite、webpack、Babel 的插件机制都是开闭原则的体现：核心流程不动，通过插件扩展。用映射表消除分支的更多写法见 [策略模式](/basics/design-pattern/04-strategy)。

```js
// 改造前：每加一种通知渠道，都要修改 notify
function notify(user, msg, channel) {
  if (channel === 'email') sendEmail(user.email, msg)
  else if (channel === 'sms') sendSms(user.phone, msg)
}
```

```js
// 改造后：渠道通过注册来扩展，notify 不再改动
const channels = new Map()
const registerChannel = (name, send) => channels.set(name, send)

function notify(user, msg, channel) {
  const send = channels.get(channel)
  if (!send) throw new Error(`未知的通知渠道：${channel}`)
  return send(user, msg)
}

// 新增渠道时只加一行注册，比如企业微信、站内信
registerChannel('email', (user, msg) => sendEmail(user.email, msg))
registerChannel('sms', (user, msg) => sendSms(user.phone, msg))
```

### L：里氏替换原则

子类型必须能替换父类型，并且程序行为依然正确。关键不是"能不能继承"，而是遵守父类型的约定：不能对参数提出更严格的要求，返回值和抛出的异常也要在父类型承诺的范围内。Node.js 中常见的违反方式是同步接口配上异步实现：

```js
class MemoryCache {
  #map = new Map()
  get(key) {
    return this.#map.get(key) // 约定：同步返回缓存的值
  }
}
class RedisCache extends MemoryCache {
  get(key) {
    return redis.get(key) // 返回的是 Promise：调用方写的 cache.get(key) ?? defaultValue 永远拿到 Promise
  }
}
```

修正的办法是一开始就把约定定成异步：所有实现的 `get` 都返回 Promise，调用方统一 `await`，内存版和 Redis 版就能自由替换。

### I：接口隔离原则

不应该强迫使用方依赖它用不到的东西。前端最常见的是组件的 props：

```ts
interface User { id: number; name: string; avatar: string; email: string; roles: string[] }

// 改造前：头像卡片要求传入完整的 User，复用时得凑齐所有字段，写测试也要造完整的数据
type UserCardPropsBefore = { user: User }
// 改造后：只依赖真正用到的字段，评论区、搜索结果里的作者信息都能直接复用
type UserCardProps = Pick<User, 'name' | 'avatar'>
```

服务端也一样：一个只需要读配置的函数，参数类型写成 `{ get(key: string): Promise<string | null> }` 就够了，不必依赖整个存储服务的接口。

### D：依赖倒置原则

高层模块（业务逻辑）不应该依赖低层模块（数据库、HTTP 客户端）的具体实现，两者都应该依赖抽象。在 JS 里，抽象通常就是一个约定好的对象形状，通过参数传进来。改造前，业务函数直接 import 数据库模块、在里面写 SQL，测试时只能连真实的数据库或者 mock 整个模块；改造后：

```js
// 业务逻辑只认 findById 这个约定，不关心背后是 MySQL 还是别的存储
function createUserService({ userRepo }) {
  return {
    async getProfile(id) {
      const user = await userRepo.findById(id)
      if (!user) throw new Error('用户不存在')
      return { id: user.id, name: user.name }
    },
  }
}
// 生产环境传入 MySQL 的实现；测试时传入一个内存版本即可
const service = createUserService({ userRepo: { findById: async (id) => ({ id, name: 'Tom' }) } })
console.log(await service.getProfile(1)) // { id: 1, name: 'Tom' }
```

### 不要教条化

- 每多一层抽象，就多一个要理解的概念、多一次代码跳转。只有一种实现、短期内也不会有第二种时，不必先定义接口
- 常见的经验是"三次法则"：同样的逻辑出现第三次时再抽象，过早抽象往往抽错了方向
- SOLID 更适合用来诊断问题：改一个需求要动很多文件、写测试要 mock 一大堆依赖时，再对照原则找原因，而不是写代码前逐条套用

## 面试官可能追问

::: details 依赖倒置和依赖注入是什么关系？
依赖倒置是原则：依赖抽象，不依赖具体实现。依赖注入是实现它的手段：依赖由外部创建好再传进来（通过构造函数、函数参数），而不是在内部自己 import 或 new。NestJS、Angular 的 IoC 容器把"创建依赖并注入"这件事自动化了；Vue 的 provide / inject 也是一种依赖注入。
:::

::: details 单一职责的"职责"怎么划分？
按"修改的原因"划分，而不是按"做了几件事"。违反的信号有：文件特别长、引入了很多互不相关的模块、改一个小需求要动这个模块里互不相关的几处、写测试要 mock 很多依赖。但也不要拆得太碎，一个功能被拆进十几个小文件，读代码时要来回跳转，同样难以维护。
:::

::: details 在 React、Vue 这类偏函数式的代码里，SOLID 还适用吗？
思想同样适用，只是载体从类变成了组件和函数：组件和组合式函数各管一件事（单一职责）；通过插槽、render props 扩展组件，而不是不断加 `if`（开闭）；props 只要求真正用到的数据（接口隔离）；依赖通过 props 或 provide / inject 传入（依赖倒置）；封装的输入框组件遵守和原生输入框一样的 `v-model` 约定，才能直接替换（里氏替换）。
:::

## 易错点

- 单一职责不等于"一个函数只能有几行"，拆得太碎反而难读
- 开闭原则不是"永远不改旧代码"，而是在确实会频繁变化的地方预留扩展点
- 里氏替换看的是行为约定是否一致，而不是能不能继承
- 依赖倒置不等于一定要引入依赖注入框架，用函数参数传入依赖就够了
