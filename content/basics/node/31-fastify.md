---
difficulty: 2
tags: [原理, 对比]
---

# Fastify 为什么比 Express 快？它的插件封装和钩子是怎么设计的？

::: tip 一句话回答
Fastify 快在把能提前做的事都提前做了：用 **JSON Schema** 描述请求和响应，启动时由 **Ajv** 编译成校验函数、由 **fast-json-stringify** 生成序列化函数（比通用的 `JSON.stringify` 快）；路由用 **find-my-way**（基数树）匹配；日志用高性能的 **pino**。设计上它不用 Express 那样的中间件链，而是**插件 + 封装上下文 + 生命周期钩子**：每个插件有自己的作用域，装饰器和钩子默认只对本插件及子插件生效，需要共享时用 `fastify-plugin` 打破封装。
:::

## 详细解析

### 为什么快

- **校验编译成函数**：路由声明了 `schema`，Fastify 用 Ajv 把它编译成一个专用的校验函数，请求来了直接调用，不用每次解释 schema。校验失败自动返回 400
- **按 schema 序列化**：声明了响应 schema 后，用 fast-json-stringify 生成序列化函数。它事先知道字段和类型，不需要像 `JSON.stringify` 那样逐个判断值的类型。官方还提到响应 schema 能防止敏感字段被意外返回
- **路由用基数树**：find-my-way 按路径前缀组织路由，匹配时间和路由数量关系不大；Express 是按注册顺序逐个尝试正则
- **日志用 pino**：输出 JSON，开销很小；Fastify 的日志默认关闭，用 `logger: true` 开启
- **装饰器固定对象形状**：用 `decorateRequest` 提前声明字段，而不是在钩子里随手 `req.user = ...`，引擎可以按固定形状优化属性访问

这些优化主要体现在框架本身的开销上。业务慢在数据库时，换框架带来的提升有限；官方的对比数据也说明了结果依赖硬件和负载，不要背数字。

### 插件和封装

```text
root
├── 插件 A（注册 db 装饰器，用 fastify-plugin 包裹 → 提升到 root，所有人可用）
├── 插件 B：/admin（注册鉴权钩子 → 只对 /admin 下的路由生效）
│   └── 子插件 B1（继承 B 的钩子和装饰器）
└── 插件 C：/public（看不到 B 的鉴权钩子）
```

- `fastify.register(plugin, opts)` 会创建一个新的作用域，插件里的 `decorate`、`addHook`、路由只影响自己和后代，不影响父级和兄弟
- 子上下文能用祖先注册的东西，父级看不到子级注册的东西
- 想让插件注册的东西对父级可见（比如数据库连接、通用工具），用 `fastify-plugin` 包一层，它只打破被包裹插件这一层的封装
- 好处：鉴权、限流这类逻辑可以只套在一组路由上，插件之间不会互相污染，比全局中间件更安全

### 请求生命周期和钩子

```text
Routing → onRequest → preParsing → 解析 body → preValidation → 校验（失败 400）
→ preHandler → handler → preSerialization → onSend → 发送响应 → onResponse
```

| 钩子 | 常见用途 |
| --- | --- |
| `onRequest` | 鉴权、限流；此时 `request.body` 还是 `undefined` |
| `preParsing` | 在解析前处理请求流，如解压 |
| `preValidation` | 校验前修改数据 |
| `preHandler` | 依赖 body 的鉴权、加载用户 |
| `preSerialization` | 序列化前修改返回的对象 |
| `onSend` | 修改最终的响应内容或响应头 |
| `onResponse` | 响应已发出，记录耗时、上报统计 |
| `onError` | 记录错误日志，不用来修改错误，先于 `setErrorHandler` 执行 |

另外还有 `onTimeout`、`onRequestAbort`，以及应用级的 `onReady`、`onClose` 等。`onClose` 适合关闭数据库连接池，是唯一不受封装影响的钩子。

### 和 Express 的区别

| 维度 | Express | Fastify |
| --- | --- | --- |
| 扩展方式 | 中间件链，`next()` 往下传 | 插件 + 钩子，按生命周期阶段挂载 |
| 作用范围 | 主要靠挂载路径区分 | 封装上下文，天然隔离 |
| 校验和序列化 | 自己接入 | 内置 JSON Schema |
| async 处理函数 | 较新的版本才处理 Promise 拒绝 | 原生支持，抛出的错误统一进 `setErrorHandler` |
| 中间件生态 | 原生 | 要用 `@fastify/express` 或 `@fastify/middie` 兼容 |

中间件模型的细节见 [Express 和 Koa 的中间件](/basics/node/05-middleware)。

## 代码示例

```js
import Fastify from 'fastify'
import fp from 'fastify-plugin'

const app = Fastify({ logger: true })

// 用 fp 包裹：db 装饰器对整个应用可见
app.register(fp(async (fastify) => {
  fastify.decorate('db', { findUser: async (id) => ({ id, name: 'Tom', password: 'x' }) })
}))

// 不包裹：鉴权钩子只作用于这个插件里的路由
app.register(async (admin) => {
  admin.decorateRequest('user', null) // 先声明字段，每个请求再赋值
  admin.addHook('onRequest', async (req, reply) => {
    if (req.headers.authorization !== 'Bearer demo') {
      return reply.code(401).send({ message: 'unauthorized' })
    }
    req.user = { role: 'admin' }
  })
  admin.get('/users/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      // 响应只序列化声明过的字段，password 不会被返回
      response: { 200: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } },
    },
  }, async (req) => admin.db.findUser(req.params.id)) // async 处理函数直接 return
}, { prefix: '/admin' })

app.setErrorHandler((err, req, reply) => {
  req.log.error(err)
  reply.code(err.statusCode ?? 500).send({ message: err.statusCode ? err.message : 'internal error' })
})

await app.listen({ port: 3000 })
```

## 面试官可能追问

::: details 为什么不能在钩子里直接给 request 加属性，要用 decorateRequest？
直接加属性会在请求处理过程中改变对象的形状，引擎对属性访问的优化会失效。`decorateRequest` 在启动时声明字段，所有请求对象形状一致。注意不要用对象、数组这类引用类型作为初始值，它们会被所有请求共享，Fastify 会直接报错；用 `null` 占位，在钩子里给每个请求赋新对象。
:::

::: details async 处理函数里既 return 又调用 reply.send，会怎样？
以 return 的值为准，`reply.send` 的内容被丢弃并打 warn 日志。在 async 函数里用 `reply.send` 时要 `return reply`，否则可能出现重复发送。钩子也一样，回调式和 async 写法不要混用。
:::

::: details 插件注册是异步的，怎么保证依赖的插件先加载？
Fastify 用 avvio 按注册顺序依次加载插件，`await app.register(...)` 或 `app.after()` 可以等前面的插件加载完。`fastify-plugin` 还可以声明 `name` 和 `dependencies`，缺少依赖时启动就报错。
:::

## 易错点

- 只声明了请求 schema 没声明响应 schema：序列化走的还是 `JSON.stringify`，也起不到过滤字段的作用
- 以为在一个插件里加的钩子是全局的：默认只作用于该插件及子插件，兄弟插件里的路由不受影响
- 在 `onRequest` 里读 `request.body`：这时还没解析，永远是 `undefined`，依赖 body 的逻辑放到 `preValidation` 或 `preHandler`
- 在 `onError` 里改错误或发送响应：它只适合记录日志，自定义错误响应写在 `setErrorHandler` 里
