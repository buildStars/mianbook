---
difficulty: 2
tags: [原理, 实践]
---

# 职责链模式是什么？前端里有哪些例子？

::: tip 一句话回答
职责链模式把多个处理者串成一条链，请求从链头开始传递，**每个处理者自己决定**是处理掉，还是交给下一个。发送者只需要把请求交给链头，不用知道最终由谁处理；处理者可以随时增删、调整顺序。前端常见的例子有 axios 的拦截器链、表单的逐条校验、按金额分级的审批流程。DOM 事件冒泡、Express 和 Koa 的中间件也是职责链的变体，Koa 的洋葱模型还让每个处理者能在下游完成之后再执行一段逻辑。
:::

## 详细解析

### 两种形态

- **纯粹的职责链**：只有一个处理者真正处理请求，比如按金额分级审批，谁有权限谁来批
- **管道式**：每个处理者都处理一部分，再交给下一个，必要时提前结束，比如中间件、拦截器

### 一个通用的链

每个处理者接收请求和 `next`，自己决定要不要调用 `next`：

```js
function createChain(handlers, fallback) {
  // 从后往前组装：每个处理者拿到的 next，就是它后面的那一段链
  return handlers.reduceRight((next, handler) => (req) => handler(req, next), fallback)
}

// 按报销金额分级审批，每一级只处理自己权限内的
const approve = createChain(
  [
    (req, next) => (req.amount <= 1000 ? '组长审批' : next(req)),
    (req, next) => (req.amount <= 10000 ? '经理审批' : next(req)),
    (req, next) => (req.amount <= 100000 ? '总监审批' : next(req)),
  ],
  () => '超出审批权限，转线下流程', // 兜底：没有处理者能处理时
)

console.log(approve({ amount: 500 }))    // 组长审批
console.log(approve({ amount: 5000 }))   // 经理审批
console.log(approve({ amount: 500000 })) // 超出审批权限，转线下流程
```

以后新增一级"副总审批"，只要往数组里插入一个处理者，发起审批的代码不用改。

表单校验也可以组织成链：必填、格式这些同步检查放在前面，"用户名是否已被占用"这种要请求接口的检查放在最后，前面任何一步失败就直接返回错误，不发多余的请求。每一步具体怎么校验，可以用[策略模式](/basics/design-pattern/04-strategy)定义成可复用的规则。

### axios 的拦截器链

axios 把请求拦截器、真正发请求的函数和响应拦截器排成一个数组，再用 Promise 依次串起来。每个拦截器可以修改配置或响应，也可以返回 rejected Promise 中断后面的流程。简化实现：

```js
function createClient(dispatch) {
  const requestInterceptors = []
  const responseInterceptors = []
  return {
    interceptors: {
      request: { use: (fulfilled, rejected) => requestInterceptors.push({ fulfilled, rejected }) },
      response: { use: (fulfilled, rejected) => responseInterceptors.push({ fulfilled, rejected }) },
    },
    request(config) {
      // 和 axios 一致：请求拦截器倒序执行（后添加的先执行），响应拦截器正序执行
      const chain = [...requestInterceptors].reverse().concat({ fulfilled: dispatch }, responseInterceptors)
      return chain.reduce((promise, { fulfilled, rejected }) => promise.then(fulfilled, rejected), Promise.resolve(config))
    },
  }
}

// 用一个假的 dispatch 代替真正的网络请求
const client = createClient(async (config) => ({ status: 200, data: `响应 ${config.url}`, config }))
client.interceptors.request.use((config) => ({ ...config, headers: { Authorization: 'Bearer token' } }))
client.interceptors.response.use((res) => res.data) // 只把 data 交给调用方
console.log(await client.request({ url: '/user' })) // 响应 /user
```

### 和 Koa 洋葱模型的关系

中间件就是职责链：每个中间件可以处理请求并结束（比如鉴权失败直接返回 401、缓存命中直接返回），也可以调用 `next` 交给下一个。区别在于经典的职责链是单向的，请求交出去之后就和自己无关了；Koa 的 `await next()` 会等下游全部完成后再回到当前中间件，每个处理者都有前后两段，所以能做耗时统计、事务提交这类需要前后配合的事，详见 [Express 和 Koa 的中间件](/basics/node/05-middleware)。

DOM 的事件冒泡也是一条职责链：事件从目标元素沿着祖先逐层向上传，任何一层都可以处理，也可以调用 `stopPropagation()` 让它不再往上传，见 [事件流和事件委托](/basics/browser/04-event-delegation)。

## 面试官可能追问

::: details 怎么用响应拦截器处理 401，刷新 token 后重放请求？
在响应拦截器的错误分支里判断 401，刷新 token 后用原来的配置重新发请求。多个请求同时遇到 401 时，要共用同一次刷新：

```js
let refreshing = null

http.interceptors.response.use(undefined, async (error) => {
  const { config, response } = error
  if (response?.status !== 401 || config._retried) return Promise.reject(error)
  config._retried = true // 刷新后仍然 401 时不再重试，避免死循环
  refreshing ??= refreshToken().finally(() => { refreshing = null })
  await refreshing
  return http(config) // 重放原请求，请求拦截器会带上新的 token
})
```

刷新本身也失败时，跳转到登录页。token 刷新的整体设计见 [Cookie、Session、Token、JWT 的区别](/basics/network/13-auth)。
:::

::: details 职责链模式有什么缺点？
- 请求可能走完整条链都没人处理，所以末尾要有兜底
- 链很长时不好调试，看不出请求是被哪个处理者处理的，可以在链上加日志
- 处理者之间有顺序依赖，比如鉴权必须在业务处理之前，调整顺序时要小心
:::

::: details 职责链和装饰器都是一层套一层，有什么区别？
装饰器围绕一个核心对象叠加功能，最终一定会调用这个核心对象；职责链里的处理者是平级的，每一个都可能是终点，请求可能在任何一环被处理掉、不再往下传。关注点也不同：装饰器关心怎么增强一个对象，职责链关心请求应该由谁处理。见 [装饰器模式](/basics/design-pattern/06-decorator)。
:::

## 易错点

- 链的末端没有兜底，请求可能没人处理，静默地返回 `undefined`
- axios 的请求拦截器是后添加的先执行，和响应拦截器的顺序相反
- 拦截器的错误分支没有返回 `Promise.reject(error)`：错误会被"吞掉"，调用方拿到的是一个值为 `undefined` 的成功结果
