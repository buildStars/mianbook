---
difficulty: 1
tags: [高频]
---

# Map、Set 和 WeakMap、WeakSet 有什么区别？

::: tip 一句话回答
Map 是键值对集合，键可以是任意类型，并保持插入顺序；Set 是不重复值的集合，常用来去重。WeakMap 的键、WeakSet 的成员必须是对象（ES2023 起也可以是未注册的 Symbol），并且是**弱引用**，不会阻止垃圾回收，也因此不能遍历、没有 `size`。WeakMap 适合给对象关联数据、按对象缓存结果，对象被回收后，关联的数据会自动释放。
:::

## 详细解析

### Map 和普通对象

| | Map | 普通对象 |
| --- | --- | --- |
| 键的类型 | 任意类型，包括对象和函数 | 字符串或 Symbol，其他类型会被转成字符串 |
| 顺序 | 按插入顺序 | 整数键按升序排在最前面，其余按插入顺序 |
| 大小 | `size` 属性 | 要用 `Object.keys(obj).length` 计算 |
| 遍历 | 本身可迭代，直接 `for...of` | 借助 `Object.keys`、`Object.entries` |
| 和原型属性冲突 | 不会 | 可能，比如 `toString`；可以用 `Object.create(null)` 避免 |
| 频繁增删 | 通常性能更好 | 没有针对这种场景优化 |
| JSON 序列化 | 不能直接序列化 | 可以 |

```js
const map = new Map()
map.set(1, 'number').set('1', 'string')
console.log(map.size) // 2：数字 1 和字符串 '1' 是不同的键

const obj = {}
obj[1] = 'number'
obj['1'] = 'string'
console.log(Object.keys(obj).length) // 1：数字键被转成了字符串 '1'
```

### Set

Set 存储不重复的值，最常见的用法是数组去重：

```js
const unique = [...new Set([3, 1, 3, 2, 1])] // [3, 1, 2]

const set = new Set([NaN, NaN, {}, {}])
console.log(set.size) // 3：NaN 只算一个，两个 {} 是不同的引用
```

Map 的键和 Set 的值都用 **SameValueZero** 算法判断是否相同：和 `===` 的区别是认为 `NaN` 等于 `NaN`；和 `Object.is` 的区别是认为 `+0` 等于 `-0`。

### WeakMap 和 WeakSet

| | Map / Set | WeakMap / WeakSet |
| --- | --- | --- |
| 键（成员）的类型 | 任意值 | 只能是对象；ES2023 起也可以是未注册的 Symbol（不是用 `Symbol.for` 创建的） |
| 引用方式 | 强引用，会阻止回收 | 弱引用，不阻止回收 |
| 遍历、`size`、`clear` | 有 | 都没有 |
| 方法 | 完整 | WeakMap 只有 `get`、`set`、`has`、`delete`；WeakSet 只有 `add`、`has`、`delete` |

弱引用的意思是：键对象在其他地方都不再被引用后，可以被[垃圾回收](/basics/javascript/15-garbage-collection)，它在 WeakMap 中的条目也随之消失。值是强引用，但只在键存活期间被持有。

### 应用场景

- **给 DOM 节点或对象关联额外数据**：节点被移除并回收后，数据自动释放，不用手动删除
- **存放对象的私有数据**：以实例为键保存私有状态，拿不到这个 WeakMap 就访问不到
- **按对象缓存计算结果**：对象不再使用时，缓存也跟着释放
- **深拷贝时记录已拷贝过的对象**：用来处理循环引用，见[深拷贝](/basics/javascript/10-deep-clone)
- **Vue 3 的响应式系统**：用 WeakMap 以原始对象为键存储依赖关系，见 [Vue 3 响应式原理](/basics/vue/01-reactivity)

```js
const cache = new WeakMap()

function getStats(data) {
  if (!cache.has(data)) {
    cache.set(data, heavyCompute(data)) // 同一个对象只计算一次
  }
  return cache.get(data)
}
// data 对象不再被使用后，缓存的结果会随它一起被回收
```

### WeakRef 和 FinalizationRegistry

了解即可。`WeakRef` 持有一个对象的弱引用，`deref()` 取回对象，对象已被回收则返回 `undefined`；`FinalizationRegistry` 可以在对象被回收后执行一个回调。对象什么时候被回收、回调会不会执行都没有保证，不要让业务逻辑依赖它们。

## 面试官可能追问

::: details WeakMap 为什么不能遍历，也没有 size？
键随时可能被回收，而回收什么时候发生由引擎决定，无法预测。如果允许遍历或读取 `size`，结果就取决于垃圾回收有没有发生，同样的代码可能得到不同的结果。所以规范不提供这些操作，只能用手里已有的键去查。
:::

::: details 用对象作为 Map 的键要注意什么？
键按引用比较，必须是同一个对象才能取到值：

```js
const map = new Map()
map.set({ id: 1 }, 'a')
map.get({ id: 1 }) // undefined：两个字面量是不同的对象

const key = { id: 1 }
map.set(key, 'b')
map.get(key) // 'b'
```

另外，Map 会一直强引用这个键对象，即使别处已经不用了，只要没从 Map 中删除，它就不会被回收。如果只是想给对象关联数据，用 WeakMap 更合适。
:::

::: details Map 和普通对象怎么选？
- 结构固定、键是已知的字符串、需要 JSON 序列化（如配置、接口数据）：用对象
- 键在运行时动态增删，或者键不是字符串，或者需要按插入顺序遍历、知道元素个数：用 Map
- 以对象为键关联数据，又不想影响对象被回收：用 WeakMap
:::

## 易错点

- WeakMap 只对**键**是弱引用，值是强引用
- Set 对对象按引用去重，内容相同的两个对象不会被去掉
- 不要用 `map[key] = value` 给 Map 赋值，那样设置的是 Map 对象自身的属性，`get` 取不到，`size` 也不变
