---
difficulty: 2
tags: [高频, 对比]
---

# 观察者模式和发布订阅模式有什么区别？

::: tip 一句话回答
两者都是"状态变化时通知依赖方"，区别在于**有没有中间人**。观察者模式中，**目标（Subject）自己维护观察者列表**，状态变化时直接调用观察者，双方互相知道对方。发布订阅模式中，发布者和订阅者都只和**事件中心**打交道，按事件名匹配，彼此不知道对方的存在，耦合更低，还能扩展到跨模块、跨进程。Vue 的依赖收集、DOM 的事件监听更接近观察者模式；事件总线、消息队列是发布订阅模式。
:::

## 详细解析

### 结构对比

```text
观察者模式：目标直接通知观察者
  Subject（自己保存观察者列表）
     │ 状态变化时遍历列表，直接调用
     ├──> observerA.update(state)
     └──> observerB.update(state)

发布订阅模式：通过事件中心转发
  发布者 ── publish('order:paid', data) ──> 事件中心（事件名 → 回调列表）
                                               │ 按事件名找到订阅者
                                               ├──> 积分模块的回调
                                               └──> 通知模块的回调
  发布者和订阅者互不知道对方，只约定事件名和数据格式
```

| | 观察者模式 | 发布订阅模式 |
| --- | --- | --- |
| 参与者 | 目标 + 观察者 | 发布者 + 事件中心 + 订阅者 |
| 耦合 | 目标持有观察者的引用，观察者要实现约定的方法 | 双方只依赖事件中心和事件名 |
| 通知方式 | 目标直接调用观察者 | 由事件中心转发，可以过滤、排队、异步处理，甚至跨进程 |
| 例子 | Vue 的依赖收集、DOM 事件、IntersectionObserver | 事件总线（如 mitt）、Redis Pub/Sub、消息队列 |

也有观点认为发布订阅只是观察者模式的一种变体。面试时讲清"有没有事件中心"这个核心区别，再结合例子说明即可。

### 代码对比

```js
// 观察者模式：目标自己维护观察者列表
class Subject {
  #observers = new Set()

  attach(observer) {
    this.#observers.add(observer)
  }
  detach(observer) {
    this.#observers.delete(observer)
  }
  setState(state) {
    this.#observers.forEach((observer) => observer.update(state))
  }
}

const cart = new Subject()
cart.attach({ update: (state) => console.log('购物车角标：', state.count) })
cart.setState({ count: 3 }) // 购物车角标： 3
```

```js
// 发布订阅模式：发布者和订阅者只认识事件中心
function createEventBus() {
  const topics = new Map() // 事件名 -> 回调集合
  return {
    subscribe(topic, handler) {
      if (!topics.has(topic)) topics.set(topic, new Set())
      topics.get(topic).add(handler)
      return () => topics.get(topic)?.delete(handler) // 返回取消订阅的函数
    },
    publish(topic, payload) {
      topics.get(topic)?.forEach((handler) => handler(payload))
    },
  }
}

const bus = createEventBus()
// 积分模块和通知模块各自订阅，订单模块不知道它们的存在
bus.subscribe('order:paid', (order) => console.log('增加积分', order.amount))
const unsubscribe = bus.subscribe('order:paid', (order) => console.log('发送通知', order.id))
// 订单模块只负责发布
bus.publish('order:paid', { id: 'A001', amount: 99 })
unsubscribe()
```

再加一个"支付后发优惠券"的功能，只要多订阅一次，订单模块的代码不用改。

### 对应的真实例子

- **Vue 的响应式**：每个响应式属性维护一个依赖集合，相当于 Subject；组件渲染、computed、watch 这些副作用就是观察者。读取属性时收集依赖，修改时直接通知它们，没有事件名，也没有中间人，见 [Vue 3 的响应式原理](/basics/vue/01-reactivity)
- **DOM 事件**：元素自己保存监听器，`addEventListener` 直接注册在目标元素上，属于观察者模式，只是多了事件类型和冒泡传播，见 [事件流和事件委托](/basics/browser/04-event-delegation)
- **Node.js 的 EventEmitter**：用在流、socket 上时，订阅的就是这个对象本身，接近观察者模式；拿一个全局的 emitter 当事件总线时，它就是事件中心，见 [EventEmitter 的原理](/basics/node/09-event-emitter)
- **消息队列**：Kafka、RabbitMQ 这类中间件是跨进程的事件中心，生产者和消费者可以独立部署、独立扩容

## 面试官可能追问

::: details 发布订阅模式有什么缺点？
- 数据流向难追踪：只看发布的代码，不知道谁在订阅、会触发哪些逻辑，事件一多就很难维护
- 事件名写错不会报错，只是静默地没有效果
- 忘记取消订阅会造成内存泄漏和重复执行，比如组件卸载后回调还在
- 同步通知时，一个订阅者抛错会中断后面的订阅者，事件中心可以给每个回调单独 try/catch

Vue 3 去掉了实例上的 `$on`，也是因为组件之间大量用事件总线会让数据流向混乱，见 [Vue 组件之间有哪些通信方式](/basics/vue/04-component-communication)。
:::

::: details 怎么给事件总线加上 TypeScript 类型？
用一个类型把事件名和数据格式对应起来，订阅和发布时都按它检查。mitt 就支持这种写法：

```ts
import mitt from 'mitt'

type Events = {
  'order:paid': { id: string; amount: number }
  'cart:change': number
}

const bus = mitt<Events>()
bus.on('order:paid', (order) => console.log(order.amount)) // order 的类型自动推断
bus.emit('cart:change', 3)
bus.emit('cart:change', '3') // 类型错误：string 不能赋给 number
bus.emit('order:pay', { id: 'A001', amount: 99 }) // 类型错误：没有这个事件名
```
:::

::: details 消息队列和前端的事件总线都是发布订阅，有什么不同？
事件总线在一个页面或进程的内存里，同步调用回调，刷新页面或重启进程后订阅关系就没了，消息也不会保存。消息队列是独立部署的中间件：消息会持久化，消费者离线后可以稍后再处理；有确认和重试机制，保证消息至少被处理一次；同一类消息可以由一组消费者分摊。所以它适合服务之间的异步解耦，比如下单后异步发短信、更新搜索索引。
:::

## 易错点

- 区别不在于有没有 `subscribe` 这个方法名，而在于有没有独立的事件中心
- 订阅之后忘记取消，组件卸载后回调还在执行
- 事件名用字符串硬编码，拼写错误不会报错
- 跨标签页、跨进程的场景，内存里的事件总线无能为力，要用 BroadcastChannel（见 [多个标签页之间怎么通信](/basics/browser/17-cross-tab)）或消息队列
