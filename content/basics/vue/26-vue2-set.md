---
difficulty: 2
tags: [高频, 原理]
---

# Vue 2 中为什么给对象新增属性、通过下标改数组不会触发更新？$set 是怎么解决的？

::: tip 一句话回答
Vue 2 用 `Object.defineProperty` 在初始化时给**已有的每个属性**装上 getter/setter，后来新增的属性没有被装过，读写都拦截不到。数组如果按下标逐个拦截成本太高，数组的 `length` 也拦截不了，所以 Vue 2 改为**重写 7 个变异方法**（`push`、`pop`、`shift`、`unshift`、`splice`、`sort`、`reverse`），通过下标赋值就不会被发现。`$set` 对数组调用改写过的 `splice`，对对象调用 `defineReactive` 补装拦截并**手动通知依赖**。Vue 3 换成了 **Proxy**，拦截的是整个对象的操作，所以不再需要 `$set`。
:::

## 详细解析

### defineProperty 只认识已有属性

`defineProperty` 是针对"某个对象的某个属性"定义的。Vue 2 初始化时遍历 `data` 返回的对象，对每个 key 调用 `defineReactive`，在 getter 里收集依赖，在 setter 里通知更新。

```js
const data = { name: 'a' }
Object.defineProperty(data, 'name', {
  get() { console.log('读 name'); return 'a' },
  set(v) { console.log('写 name', v) },
})

data.name = 'b' // 写 name b，能拦截
data.age = 18   // 没有任何输出，age 从未被定义过拦截
```

删除属性也一样，`delete obj.key` 不会触发 setter，所以 Vue 2 还提供了 `$delete`。

### 数组为什么不按下标拦截

技术上可以对数组的每个下标调用 `defineProperty`，但数组常常很大，元素又频繁增删，每次都要重新给下标装拦截，开销和收益不成比例。另外数组的 `length` 属性不可配置，`arr.length = 0` 这种写法无论如何都拦截不到。

Vue 2 的做法是：创建一个以 `Array.prototype` 为原型的对象，在上面重写 7 个会修改数组的方法，再把响应式数组的原型指向它。调用这些方法时，先执行原生逻辑，再对新插入的元素做响应式处理，最后通知依赖。`arr[0] = x` 不经过这些方法，所以不会更新。

### $set 做了什么

Vue 2 源码里 `set(target, key, val)` 的主要逻辑：

1. **数组且下标合法**：必要时扩大 `length`，然后 `target.splice(key, 1, val)`。走的是改写过的 `splice`，自然会触发更新
2. **对象上已有这个属性**：直接赋值，它本来就有 setter
3. **对象不是响应式的**（没有 `__ob__`）：直接赋值，不做额外处理
4. **新增属性**：`defineReactive(ob.value, key, val)` 补装 getter/setter，再 `ob.dep.notify()`

第 4 步的 `ob.dep` 是挂在对象自身上的依赖集合。渲染时读取 `this.user`，除了收集 `user` 这个属性的依赖，还会把当前 watcher 收集进 `user` 对象的 `__ob__.dep`。所以新增属性后通知这个 dep，用到 `user` 的组件就会重新渲染。

另外，`$set` 不允许给 Vue 实例本身或根级 `data` 新增属性，开发环境会给出警告。根级的字段要在 `data` 里提前声明。

### Vue 3 为什么不需要

Proxy 代理的是整个对象，拦截的是"操作"而不是"属性"：

| 操作 | Vue 2 | Vue 3 |
| --- | --- | --- |
| 新增属性 `obj.x = 1` | 拦截不到，用 `$set` | `set` 拦截 |
| 删除属性 `delete obj.x` | 拦截不到，用 `$delete` | `deleteProperty` 拦截 |
| 下标赋值 `arr[0] = 1` | 拦截不到 | `set` 拦截 |
| 修改 `arr.length` | 拦截不到 | `set` 拦截 |
| `key in obj`、遍历 key | 无法感知新增的 key | `has`、`ownKeys` 拦截 |

所以 Vue 3 去掉了 `$set` 和 `$delete`。Proxy 的拦截细节见 [Vue 3 响应式原理](/basics/vue/01-reactivity)，两个版本的整体对比见 [Vue 3 和 Vue 2 的区别](/basics/vue/02-vue3-vs-vue2)。

## 面试官可能追问

::: details 不用 $set 还有什么办法？
对象可以整体替换：`this.user = { ...this.user, age: 18 }`，替换的是已有属性 `user`，会触发 setter，新对象也会被重新做响应式处理。数组用 `splice` 代替下标赋值，或者 `this.list = newList` 整体替换。
:::

::: details Vue 2 修改嵌套很深的属性能被检测到吗？
能，只要这个属性是初始化时就存在的。Vue 2 初始化时会递归遍历整个对象，每一层都装上拦截。这也是 Vue 2 初始化大对象慢的原因；Vue 3 改成访问到哪一层才代理哪一层。
:::

::: details 改写数组方法会污染全局的 Array.prototype 吗？
不会。Vue 2 只修改响应式数组自身的原型链，让它指向一个继承自 `Array.prototype` 的中间对象，其他普通数组不受影响。
:::

## 易错点

- 以为 `defineProperty` 完全拦截不了数组下标。其实可以，Vue 2 是出于性能考虑放弃了
- 以为改数组元素的属性也不生效。`this.list[0].name = 'x'` 是能触发更新的，因为数组里的对象本身已经是响应式的，不生效的只是替换下标对应的元素
- 在 Vue 3 项目里还写 `this.$set`，它已经被移除，会直接报错
