---
difficulty: 1
tags: [高频]
---

# ref 和 reactive 有什么区别？该用哪个？

::: tip 一句话回答
`ref` 可以包装任意类型的值，通过 `.value` 读写，模板中会自动解包；`reactive` 只能用于对象类型，返回原对象的 Proxy，访问属性不用写 `.value`，但不能整体替换，解构后也会丢失响应性。官方推荐**优先使用 `ref`**，它没有这些限制。
:::

## 详细解析

### 对比

| | `ref` | `reactive` |
| --- | --- | --- |
| 支持的类型 | 任意类型 | 只能是对象类型：对象、数组、Map、Set 等 |
| 读写方式 | 通过 `.value`；模板中顶层的 ref 自动解包 | 直接读写属性 |
| 实现方式 | `.value` 的 getter / setter；值是对象时，内部用 `reactive` 转成深层响应式 | `Proxy` 代理整个对象，返回的是代理而不是原对象 |
| 整体替换 | 可以，给 `.value` 重新赋值 | 不行，重新赋值会断开响应式连接 |
| 解构、传给函数 | 传递 ref 本身，响应性不会丢 | 解构出的属性、传给函数的属性值都会丢失响应性 |

两者的实现、解构为什么会丢失响应性，见 [Vue 3 的响应式原理](/basics/vue/01-reactivity)。

### reactive 的局限

```js
import { reactive, toRefs, watch } from 'vue'

let state = reactive({ count: 0 })

// ❌ 解构得到的是普通值，修改它不会影响 state
let { count } = state
count++
console.log(state.count) // 0

// ✅ toRefs 把每个属性都转成和原对象关联的 ref
const { count: countRef } = toRefs(state)
countRef.value++
console.log(state.count) // 1

// ❌ 传进去的只是数字 1，相当于 watch(1, ...)，监听不到变化
watch(state.count, (val) => console.log(val))
// ✅ 传一个 getter
watch(() => state.count, (val) => console.log(val))

// ❌ 整体替换：之前收集的依赖都在旧对象上，响应式连接断开了
state = reactive({ count: 100 })
```

需要整体更新时，用 `Object.assign(state, newData)` 修改原对象，或者干脆改用 `ref`。

### ref 的自动解包

- 模板中，顶层的 ref 会自动解包，不用写 `.value`
- ref 作为 reactive 对象的属性被访问时，也会自动解包
- 但 ref 作为 reactive 数组的元素，或者 Map 这类集合中的值时，不会自动解包

```js
import { ref, reactive } from 'vue'

const count = ref(0)
const state = reactive({ count })
console.log(state.count) // 0：作为 reactive 对象的属性，自动解包
state.count++
console.log(count.value) // 1：两者是同一个 ref

const list = reactive([ref('a')])
console.log(list[0].value) // a：数组元素不会自动解包，要写 .value

const map = reactive(new Map([['key', ref('b')]]))
console.log(map.get('key').value) // b：Map 中的值也不会自动解包
```

### 该用哪个

官方推荐优先使用 `ref`：它没有 `reactive` 的那些限制，`.value` 也让人一眼看出这是响应式数据。`reactive` 适合把一组紧密相关、不需要整体替换的状态放在一起，比如一个表单对象，但要记住不能直接解构。

### 相关 API

| API | 作用 |
| --- | --- |
| `shallowRef` | 只有 `.value` 这一层是响应式的，修改内部属性不会触发更新；适合大型数据、第三方库实例 |
| `shallowReactive` | 只有顶层属性是响应式的，深层属性不做代理 |
| `toRef(obj, 'key')` | 为 reactive 对象的某个属性创建 ref，和原属性保持同步 |
| `toRefs(obj)` | 把 reactive 对象的每个属性都转成 ref，常用于解构 |
| `unref(x)` | 是 ref 就返回 `.value`，否则原样返回 |
| `isRef(x)` | 判断是不是 ref |
| `toValue(x)` | Vue 3.3 新增，和 `unref` 类似，但遇到 getter 函数会调用它并返回结果 |

## 面试官可能追问

::: details 为什么 ref 需要 .value？
`Proxy` 只能代理对象，基本类型的值没法被拦截；而且基本类型是按值传递的，赋给另一个变量后两者就没有关系了。所以 `ref` 把值包装在一个对象里，通过 `value` 属性的 getter 收集依赖、setter 触发更新。包装成对象之后，ref 在函数之间传递也不会丢失响应性。
:::

::: details shallowRef 适合什么场景？
适合只关心整体替换、不需要深层追踪的数据：一是很大的列表或嵌套很深的对象，可以省掉深层代理的开销；二是图表、地图、编辑器这类第三方库的实例，没有必要把它们转成响应式。修改 `shallowRef` 内部的属性不会触发更新，要整体替换 `.value`，或者调用 `triggerRef` 手动触发。
:::

::: details toRef 和 toRefs 有什么用？
它们在保持响应性的前提下，把 reactive 对象的属性"拆"出来。`toRef(state, 'count')` 为单个属性创建 ref，读写它就是读写 `state.count`；`toRefs(state)` 对所有属性都这样做，常用于解构，或者让组合式函数返回可以解构的对象。Vue 3.3 起 `toRef` 还可以传入 getter，比如 `toRef(() => props.id)`，得到一个只读的 ref。
:::

## 易错点

- `reactive` 返回的是代理对象，和原对象不相等；直接修改原对象不会触发更新
- 模板中只有**顶层**的 ref 会自动解包：普通对象里嵌套的 ref，在表达式 `obj.id + 1` 中不会解包，结果是 `[object Object]1`，可以先把它解构成顶层变量
- `ref` 并不只适合基本类型：包装对象时，`.value` 就是一个 reactive 代理，内部属性同样是深层响应式的
