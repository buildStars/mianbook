---
difficulty: 3
tags: [高频, 原理]
---

# Vue 3 的响应式原理是什么？

::: tip 一句话回答
Vue 3 用 `Proxy` 拦截对象的读写：**读取**属性时做依赖收集（track），记录"哪个副作用函数用到了这个属性"；**修改**属性时触发更新（trigger），重新执行依赖它的副作用函数。组件渲染、computed、watch 本质上都是这样的副作用（effect）。
:::

## 详细解析

### 核心概念

- **reactive()**：用 Proxy 代理整个对象，在 `get` 中收集依赖，在 `set`/`deleteProperty` 中触发更新
- **ref()**：通过对象的 `.value` getter/setter 实现，所以基本类型也能变成响应式
- **effect**：副作用函数。执行时会被设为"当前活跃的 effect"，执行期间读到的响应式数据都会记下它

### 简化实现

下面是经典的实现思路，真实源码还要处理缓存代理对象、避免重复触发、清理过期依赖等问题：

```js
// target -> Map<key, Set<effect>>
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  targetMap.get(target)?.get(key)?.forEach((effect) => effect())
}

function reactive(obj) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      track(target, key)
      const res = Reflect.get(target, key, receiver)
      // 访问到嵌套对象时才转成响应式（懒代理）
      return typeof res === 'object' && res !== null ? reactive(res) : res
    },
    set(target, key, value, receiver) {
      const ok = Reflect.set(target, key, value, receiver)
      trigger(target, key)
      return ok
    },
  })
}

function effect(fn) {
  activeEffect = fn
  fn()
  activeEffect = null
}

const state = reactive({ count: 0 })
effect(() => console.log('count =', state.count)) // count = 0
state.count++ // count = 1
```

### 和 Vue 2 的区别

| | Vue 2 | Vue 3 |
| --- | --- | --- |
| 实现方式 | `Object.defineProperty` 劫持每个属性 | `Proxy` 代理整个对象 |
| 新增、删除属性 | 检测不到，需要 `Vue.set` / `Vue.delete` | 可以检测 |
| 数组下标和 `length` | 检测不到，靠重写数组方法 | 可以检测 |
| 初始化 | 递归遍历所有属性 | 访问到时才代理，初始化更快 |

### 新版本的变化

Vue 3.5 重构了响应式系统的内部实现，改用版本计数和双向链表管理依赖，内存占用明显下降；Vue 3.6 进一步引入了 alien-signals 的实现思路。不过"读取时收集依赖、修改时触发更新"的核心思想没有变。

## 面试官可能追问

::: details 为什么 Proxy 要配合 Reflect 使用？
Reflect 的方法和 Proxy 的拦截器一一对应，返回值也符合拦截器的要求。更重要的是 `receiver` 参数：它能保证对象里 getter 中的 `this` 指向代理对象，这样 getter 内部访问的其他属性也能被收集为依赖。
:::

::: details 为什么解构 reactive 对象会丢失响应性？
解构就是把属性值读出来赋给普通变量，之后读写的是普通变量，不再经过 Proxy。需要解构时先用 `toRefs` 把每个属性转成 ref。
:::

::: details computed 是怎么做到缓存的？
computed 内部也是一个 effect，并带有"是否需要重新计算"的标记。依赖变化时只把它标记为脏，并通知依赖这个 computed 的地方；等下次读取 `.value` 时才重新计算。依赖没变时，多次读取都直接返回缓存值。
:::

::: details watch 和 watchEffect 有什么区别？
`watch` 要显式指定监听的数据源，默认第一次不执行，回调里能拿到新值和旧值；`watchEffect` 会立即执行一次，并自动收集回调里用到的所有响应式数据作为依赖。
:::

## 易错点

- `ref` 的 `.value` 用的是类的 getter/setter，不是 Proxy
- 嵌套对象是在被访问时才转成响应式的，不是一开始就全部代理
