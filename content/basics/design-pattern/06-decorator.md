---
difficulty: 2
tags: [实践, 对比]
---

# 装饰器模式是什么？和继承有什么区别？

::: tip 一句话回答
装饰器模式在**不修改原对象代码**的前提下，用一层包装给它**动态叠加新功能**：包装层和原对象接口相同，先做额外的事，再把调用转给原对象。JS 中最自然的实现是**高阶函数**：接收一个函数，返回增强后的函数，比如给请求加上耗时统计、失败重试；React 的高阶组件也是同样的思路。和继承相比，装饰器在运行时按需组合，多个功能可以自由叠加，不会因为功能的组合而产生大量子类。TypeScript 和 ECMAScript 的 `@decorator` 语法是这种思想在语法层面的支持。
:::

## 详细解析

### 用高阶函数实现

```js
// 统计耗时：成功、失败都记录
function withTiming(fn, label = fn.name) {
  return async function (...args) {
    const start = performance.now()
    try {
      return await fn.apply(this, args) // 用 apply 保留原来的 this 和参数
    } finally {
      console.log(`${label} 耗时 ${(performance.now() - start).toFixed(0)}ms`)
    }
  }
}

// 失败重试：每次重试前的等待时间翻倍（指数退避）
function withRetry(fn, { retries = 3, delay = 100 } = {}) {
  return async function (...args) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn.apply(this, args)
      } catch (err) {
        if (attempt >= retries) throw err
        await new Promise((resolve) => setTimeout(resolve, delay * 2 ** attempt))
      }
    }
  }
}

// 模拟一个不稳定的请求：前两次失败，第三次成功
let calls = 0
async function fetchConfig() {
  calls++
  if (calls < 3) throw new Error('网络抖动')
  return { theme: 'dark' }
}

// 原函数一行不改，按需组合
const robustFetchConfig = withTiming(withRetry(fetchConfig), 'fetchConfig')
console.log(await robustFetchConfig()) // 先打印总耗时（包含两次重试的等待），再输出 { theme: 'dark' }
```

包装的顺序会影响结果：`withTiming(withRetry(fn))` 统计的是包括重试在内的总耗时，`withRetry(withTiming(fn))` 则每次尝试都单独打印一次耗时。前端常用的防抖、节流也是这种写法（见 [防抖和节流](/basics/javascript/13-debounce-throttle)）；Node.js 的 `util.deprecate(fn, msg)` 返回的函数会在第一次调用时打印废弃警告，同样是一个装饰器。

### 高阶组件

React 的高阶组件（HOC）接收一个组件，返回增强后的组件：

```jsx
function withLoading(Component) {
  return function WithLoading({ loading, ...props }) {
    return loading ? <p>加载中...</p> : <Component {...props} />
  }
}

const UserListWithLoading = withLoading(UserList) // 用法：<UserListWithLoading loading={isLoading} users={users} />
```

现在复用逻辑更多用 Hooks 和组合式函数，HOC 主要用在"外面包一层渲染"的场景，比如权限控制、错误边界。

### 和继承的区别

假设请求客户端需要日志、缓存、重试三种可选功能。用继承实现，每种组合都要一个子类：`LoggingClient`、`CachingLoggingClient`、`RetryingCachingClient`……三种功能有 7 种组合，每多一种功能，组合数大约翻一倍。用装饰器只要写三个包装函数，按需叠加即可。

| | 继承 | 装饰器 |
| --- | --- | --- |
| 扩展的时机 | 定义类时就确定了 | 运行时按需包装 |
| 组合多个功能 | 每种组合一个子类，数量迅速膨胀 | 多层包装自由组合，顺序可调 |
| 耦合 | 子类依赖父类的实现细节，父类一改可能影响所有子类 | 只依赖被包装对象的公开接口 |
| 适合 | 稳定的"是一种"关系，需要复用父类的大量实现 | 日志、缓存、权限、重试这类和业务无关的横切功能 |

这就是常说的"组合优于继承"。JS 的继承方式见 [JS 有哪些继承方式](/basics/javascript/14-inheritance)。

### 装饰器语法

`@` 语法有两套，互不兼容：

- **TypeScript 的旧版装饰器**：开启 `experimentalDecorators` 后使用，支持类、方法、属性和参数装饰器，Angular、NestJS 等框架长期使用的是这一套
- **ECMAScript 标准装饰器**：TypeScript 5.0 起，不开启 `experimentalDecorators` 时使用这一套。装饰器函数接收 `(value, context)` 两个参数，没有参数装饰器；通常要经过 TypeScript 或 Babel 编译后运行

```ts
// 标准装饰器：给方法加上调用日志（为了简洁，类型写得比较宽松）
function log(target: any, context: ClassMethodDecoratorContext) {
  return function (this: any, ...args: any[]) {
    console.log(`调用 ${String(context.name)}`, args)
    return target.apply(this, args)
  }
}

class OrderService {
  @log
  create(sku: string, count: number) {
    return { sku, count }
  }
}

new OrderService().create('A001', 2) // 调用 create [ 'A001', 2 ]
```

## 面试官可能追问

::: details 多个装饰器叠加时，执行顺序是怎样的？
高阶函数 `a(b(fn))` 被调用时，先进入外层的 `a`，再进入 `b`，最后执行 `fn`，返回时顺序相反，和洋葱模型一样。`@` 语法写成 `@a @b method()` 时，装饰器表达式从上到下求值，应用时从下往上：先用 `b` 包装方法，再用 `a` 包装 `b` 的结果，所以 `a` 在最外层。
:::

::: details 重试装饰器能用在所有请求上吗？
不能，只适合**幂等**的操作。下单、支付这类请求可能已经在服务端执行成功，只是响应超时了，重试就会重复下单，需要配合幂等键（见 [GET 和 POST 的区别](/basics/network/10-get-vs-post)）。另外，4xx 这类客户端错误重试也不会成功，一般只重试网络错误、5xx 和 429；还要加上随机抖动和次数上限，避免大量客户端在同一时刻一起重试。
:::

::: details 装饰器模式和代理模式有什么区别？
结构相同，意图不同：装饰器为了**增加功能**，通常都会调用原对象；代理为了**控制访问**，可能根本不调用原对象，比如缓存命中、没有权限时。详见 [代理模式](/basics/design-pattern/05-proxy)。
:::

## 易错点

- 包装函数要用 `apply` 传递 `this` 和参数，否则对象的方法被装饰后，`this` 会丢失
- 装饰器的顺序会影响行为，比如耗时统计是否包含重试的时间
- TypeScript 的旧版装饰器和标准装饰器写法不兼容，要看所用的框架要求哪一套
