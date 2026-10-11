---
difficulty: 2
tags: [原理, 实践]
---

# 代理模式是什么？有哪些应用场景？

::: tip 一句话回答
代理模式给目标对象提供一个**替身**：调用方访问代理，由代理决定是否、何时、以什么方式访问真实对象。代理和目标的**接口相同**，调用方察觉不到区别。按用途分：**保护代理**做权限和参数检查，**缓存代理**缓存昂贵操作的结果，**虚拟代理**把昂贵的创建或加载推迟到真正需要的时候，比如图片预加载。ES6 的 `Proxy` 能在语言层面拦截对象的读写等操作，Vue 3 的响应式就是基于它实现的。
:::

## 详细解析

### 保护代理：控制能不能访问

```js
function createGuardedApi(api, user) {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      // 只拦截删除类的方法；prop 可能是 Symbol，先转成字符串再判断
      if (typeof value !== 'function' || !String(prop).startsWith('delete')) return value
      return (...args) =>
        user.role === 'admin' ? value.apply(target, args) : Promise.reject(new Error('没有权限'))
    },
  })
}

const api = {
  getUser: async (id) => ({ id, name: 'Tom' }),
  deleteUser: async (id) => `已删除 ${id}`,
}
const guestApi = createGuardedApi(api, { role: 'guest' })
console.log(await guestApi.getUser(1)) // { id: 1, name: 'Tom' }
guestApi.deleteUser(1).catch((err) => console.log(err.message)) // 没有权限
```

### 缓存代理：避免重复计算

```js
function cacheProxy(fn) {
  const cache = new Map()
  return function (...args) {
    const key = JSON.stringify(args)
    if (!cache.has(key)) cache.set(key, fn.apply(this, args))
    return cache.get(key) // 命中缓存时，根本不会调用原函数
  }
}

let computeCount = 0
function heavyCompute(n) {
  computeCount++ // 统计真正执行计算的次数
  return n * n
}
const compute = cacheProxy(heavyCompute)
compute(9)
compute(9) // 命中缓存，不再调用 heavyCompute
console.log(computeCount) // 1
```

缓存异步请求时，缓存的是 Promise，同一个请求还在进行中时，并发的调用会直接复用它；请求失败后要把这条缓存删掉，否则错误会一直被返回。缓存还要设置上限和过期时间，否则会变成内存泄漏。

### 虚拟代理：图片预加载

大图下载需要时间，可以先显示占位图，真实图片在后台加载完成后再替换。代理和真实对象都提供 `setSrc` 方法，调用方的代码不用改：

```js
function createImage(container) {
  const img = document.createElement('img')
  container.append(img)
  return { setSrc: (src) => { img.src = src } }
}

function createProxyImage(realImage, placeholder) {
  return {
    setSrc(src) {
      realImage.setSrc(placeholder) // 先显示占位图
      const loader = new Image()
      loader.onload = () => realImage.setSrc(src) // 真实图片下载完成后再替换
      loader.src = src
    },
  }
}

const image = createProxyImage(createImage(document.body), '/loading.svg')
image.setSrc('https://example.com/photo-large.jpg')
```

以后不需要预加载了，去掉 `createProxyImage`、直接用 `createImage` 就行，真实对象的代码不用动。图片懒加载也是虚拟代理的思路，见 [图片懒加载](/basics/browser/12-lazy-loading)。

### ES6 Proxy 和 Vue 3 响应式

`new Proxy(target, handler)` 可以拦截对象上的 13 种基本操作，常用的有 `get`、`set`、`has`、`deleteProperty`，以及拦截函数调用的 `apply`。拦截器里一般用 `Reflect` 的同名方法执行默认行为，并传入 `receiver`，保证 getter 中的 `this` 指向代理对象。Vue 3 的 `reactive()` 就是一个代理：`get` 拦截读取并收集依赖，`set` 拦截修改并通知更新，见 [Vue 3 的响应式原理](/basics/vue/01-reactivity)。

### 和装饰器模式的区别

两者结构几乎一样，都包装了目标对象，接口也相同，区别在于意图：

| | 代理 | 装饰器 |
| --- | --- | --- |
| 目的 | 控制访问：能不能访问、何时访问、要不要真的访问 | 增加功能：在原有行为上叠加新的职责 |
| 是否一定调用目标 | 不一定，缓存命中、权限不足时都不调用 | 一般都会调用被装饰的对象 |
| 目标从哪来 | 常由代理自己管理，比如虚拟代理延迟创建目标 | 由外部传入，可以层层叠加多个装饰器，见 [装饰器模式](/basics/design-pattern/06-decorator) |

## 面试官可能追问

::: details 用 Proxy 代理 Map 或带私有字段的对象，为什么会报错？
`Map`、`Set`、`Date` 的数据存放在内部插槽里，类的私有字段也类似，只有原对象自己能访问。通过代理调用 `proxy.get('a')` 时，方法里的 `this` 是代理对象，引擎找不到内部插槽，就会抛出 `TypeError`。解决办法是在 `get` 拦截器里把方法绑定到原对象：

```js
const map = new Proxy(new Map(), {
  get(target, prop) {
    const value = Reflect.get(target, prop, target) // size 是 getter，也要以原对象为 this
    return typeof value === 'function' ? value.bind(target) : value
  },
})
map.set('a', 1)
console.log(map.get('a'), map.size) // 1 1
```

Vue 3 也为集合类型单独写了一套拦截逻辑。
:::

::: details 前端还有哪些代理模式的例子？
- 开发服务器的代理配置：浏览器请求同源的开发服务器，再由它转发给后端，绕开开发环境的跨域限制（见 [跨域有哪些解决方案](/basics/browser/05-cross-origin)）
- Service Worker：拦截页面发出的请求，决定走缓存还是走网络（见 [Service Worker](/basics/browser/16-service-worker)）
- Comlink：用 Proxy 把对 Worker 的 `postMessage` 包装成普通的函数调用
- Immer：用 Proxy 记录对草稿对象的修改，据此生成新的不可变数据
:::

::: details Proxy 有性能问题吗？
有一定开销：每次属性访问都要经过拦截器，比直接访问慢。一般业务里感觉不到，但在大数组、大表格这类数据量大、访问频繁的地方会累积起来。Vue 提供了 `shallowRef`、`markRaw`，让不需要深层响应的大数据跳过代理。
:::

## 易错点

- 代理对象和原对象不是同一个引用：`proxy === target` 为 `false`，用作 Map 的键、做相等判断时要注意
- 拦截器里用 `Reflect` 执行默认行为时要传入 `receiver`，否则 getter 中的 `this` 指向原对象，绕过了代理
- 前端的保护代理只是体验上的优化（比如提前隐藏按钮、减少无效请求），真正的权限校验必须在服务端完成
