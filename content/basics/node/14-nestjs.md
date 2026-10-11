---
difficulty: 2
tags: [原理, 实践]
---

# NestJS 的依赖注入和模块化是怎样的？

::: tip 一句话回答
NestJS 用三类构件组织代码：**Module** 划分功能边界，声明自己有哪些 Controller 和 Provider、导入哪些模块、导出哪些 Provider；**Controller** 负责路由和接收请求；**Provider**（通常是 Service）承载业务逻辑。框架内置一个 **IoC 容器**：启动时扫描模块，根据**构造函数参数的类型**自动创建并注入依赖，Provider 默认是**单例**。一个请求依次经过 **Middleware → Guard → Interceptor（前） → Pipe → Controller → Interceptor（后）**，任何环节抛出的异常交给 **Exception Filter** 转成响应。底层 HTTP 默认用 Express，也可以换成 Fastify。
:::

## 详细解析

### Module、Controller、Provider

```text
UsersModule
├── controllers: [UsersController]   处理 /users 的路由
├── providers:   [UsersService]       业务逻辑，可被注入
└── exports:     [UsersService]       导出后，导入 UsersModule 的模块才能注入它
OrdersModule
└── imports:     [UsersModule]        于是 OrdersModule 里的 Provider 可以注入 UsersService
```

- Provider 默认只在声明它的模块内可见，要跨模块使用必须 `exports` 并在对方模块 `imports`，模块之间的依赖关系因此是显式的
- 标了 `@Global()` 的模块导出的 Provider 在所有模块都能注入，适合配置、日志这类基础设施，不宜滥用
- Provider 不一定是类：`{ provide: 'CONFIG', useValue: {...} }`、`useFactory`（可以是异步工厂，比如先建立数据库连接）、`useClass`（按环境替换实现），注入非类的 token 时用 `@Inject('CONFIG')`

### 依赖注入怎么实现

1. TypeScript 开启 `emitDecoratorMetadata` 后，编译器会把被装饰类的**构造函数参数类型**记录到元数据 `design:paramtypes` 中，Nest 通过 `reflect-metadata` 读取
2. 启动时，Nest 从根模块开始扫描，为每个 Provider 建立依赖图，按依赖顺序实例化，再把实例传进构造函数

所以 Nest 依赖 TypeScript 旧版的装饰器实现（`experimentalDecorators`），和 TC39 标准装饰器不是一回事，区别见 [TypeScript 装饰器](/basics/typescript/15-decorators)。类型只用 `import type` 导入、或者参数类型是接口时，运行时拿不到类型信息，注入会失败，这时要用 `@Inject(token)` 显式指定。

| 作用域 | 实例数量 | 适用场景 |
| --- | --- | --- |
| `DEFAULT` | 整个应用一个（单例） | 绝大多数 Service |
| `REQUEST` | 每个请求一个 | 需要拿到当前请求对象，如多租户按请求切换数据源 |
| `TRANSIENT` | 每个注入它的地方各一个 | 带内部状态、不能共享的工具类，如带上下文名的 logger |

`REQUEST` 作用域会**沿依赖链向上传染**：一个单例注入了请求作用域的 Provider，自己也会变成每个请求创建一次，影响性能。只是想在日志里带上 traceId，用 [AsyncLocalStorage](/basics/node/12-async-local-storage) 更合适。

### 请求生命周期

```text
请求 → Middleware → Guard → Interceptor（前） → Pipe → Controller 方法 → Service
                                                                          │
响应 ← Exception Filter（有异常时） ← Interceptor（后，逆序） ←─────────────┘
```

| 构件 | 职责 | 例子 |
| --- | --- | --- |
| Middleware | 和 Express 中间件一样，拿到原始的 req、res | 请求日志、CORS |
| Guard | 返回 true / false 决定能否继续；能拿到即将执行的处理函数及其元数据 | 鉴权、角色检查 |
| Interceptor | 包在处理函数前后，基于 RxJS 处理返回值 | 统一响应格式、耗时统计、缓存 |
| Pipe | 转换和校验参数 | `ParseIntPipe`、配合 class-validator 的 `ValidationPipe` |
| Exception Filter | 捕获异常并生成响应 | 统一错误格式、上报 |

同一类构件按"全局 → 控制器 → 路由"的顺序执行，Interceptor 的后半段反过来；Exception Filter 从最具体的路由级开始找。Guard 比 Middleware 多知道"接下来要执行哪个方法"，所以权限判断放在 Guard 里，而不是中间件里。

## 代码示例

```ts
import {
  Module, Controller, Get, Param, Injectable, ParseIntPipe, NotFoundException,
  CanActivate, ExecutionContext, NestInterceptor, CallHandler, UseGuards, UseInterceptors,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { Observable, tap } from 'rxjs'

@Injectable()
export class UsersService {
  private users = new Map([[1, { id: 1, name: 'Alice' }]])
  findOne(id: number) {
    const user = this.users.get(id)
    if (!user) throw new NotFoundException(`用户 ${id} 不存在`) // 由内置的异常过滤器转成 404
    return user
  }
}

@Injectable()
class ApiKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest()
    return req.headers['x-api-key'] === 'demo' // 返回 false 时返回 403
  }
}

@Injectable()
class TimingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = Date.now()
    return next.handle().pipe(tap(() => console.log(`耗时 ${Date.now() - start}ms`)))
  }
}

@Controller('users')
@UseGuards(ApiKeyGuard)
@UseInterceptors(TimingInterceptor)
export class UsersController {
  // 构造函数注入：容器根据参数类型找到 UsersService 的单例
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) { // 不是数字时返回 400
    return this.usersService.findOne(id)
  }
}

@Module({ controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}

@Module({ imports: [UsersModule] })
class AppModule {}

// 不用顶层 await，CommonJS 和 ESM 项目都能运行；默认使用 Express 适配器
NestFactory.create(AppModule).then((app) => app.listen(process.env.PORT ?? 3000))
```

## 面试官可能追问

::: details 两个 Service 互相依赖（循环依赖）怎么办？
Nest 在实例化时会发现无法确定顺序并报错。临时办法是两边都用 `forwardRef(() => OtherService)` 延迟解析，模块之间的循环导入同样用 `forwardRef`。但循环依赖通常说明职责划分有问题，更好的做法是把共同依赖的部分抽成第三个 Service，或者改用事件解耦。
:::

::: details 依赖注入对测试有什么好处？
依赖由容器传入，而不是在类里 `new` 出来，测试时可以替换。`Test.createTestingModule()` 创建测试模块，用 `overrideProvider(UsersRepository).useValue(mock)` 把数据库访问换成 mock，被测的 Service 代码不用改。
:::

::: details 换成 Fastify 需要改什么？
安装 `@nestjs/platform-fastify`，创建应用时传入 `new FastifyAdapter()`。Controller、Provider 这些上层代码基本不变；直接操作底层 req / res 的代码，以及 Express 专用的中间件需要改写。Nest 通过 HTTP 适配器屏蔽了底层框架的差异，这也是它和 Express、Koa 这类"库"最大的区别：它规定了应用的组织方式。
:::

## 易错点

- 构造函数参数用 `import type` 导入，或者参数类型是接口，运行时没有类型信息，注入失败
- Service 没有在模块的 `exports` 中导出，其他模块注入时报"无法解析依赖"
- 为了拿请求信息把 Service 改成 `REQUEST` 作用域，整条依赖链都变成每个请求实例化一次
- 把鉴权写在 Middleware 里：它不知道目标路由的元数据，按角色控制权限应该用 Guard
