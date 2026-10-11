---
difficulty: 2
tags: [实践, 高频]
---

# 前端测试怎么做？单元测试、组件测试和 E2E 测试怎么分工？

::: tip 一句话回答
**单元测试**测纯函数和独立的逻辑，又快又稳，用 **Vitest** 或 Jest；**组件测试**在 jsdom 里渲染组件，用 **Testing Library** 像用户一样按文字和角色查找元素、触发交互，只断言用户能看到的结果，**不测实现细节**；**E2E 测试**用 **Playwright** 或 Cypress 在真实浏览器里跑完整流程，最接近真实使用，但慢、维护成本高，只覆盖核心链路。网络请求用 **MSW** 在网络层 mock。覆盖率只能说明"哪些代码没被测到"，不能说明"测到的代码是对的"。
:::

## 详细解析

### 分层：金字塔和奖杯

- **测试金字塔**：单元测试最多，集成测试适中，E2E 最少。越往下越快、越便宜；越往上越接近真实
- **测试奖杯**：前端社区常用的变体，从下到上是静态检查（TypeScript、ESLint）、单元、集成、E2E，集成测试占比最大，因为前端的 bug 多出在组件之间、组件和接口之间的配合上
- 共同点：不要把精力都放在一层。只有 E2E 会很慢、很脆弱；只有单元测试，各部分都对，组合起来照样会坏

### 三类测试的分工

| | 单元测试 | 组件测试 | E2E 测试 |
| --- | --- | --- | --- |
| 测什么 | 工具函数、格式化、状态管理的逻辑 | 组件渲染和交互，可以包含多个组件 | 登录、下单、支付等完整流程 |
| 运行环境 | Node.js | Node.js + jsdom（或真实浏览器） | 真实浏览器 |
| 工具 | Vitest、Jest | Vitest + Testing Library | Playwright、Cypress |
| 速度 | 毫秒级 | 几十到几百毫秒 | 秒级 |
| 依赖 | 无 | mock 接口 | 真实或预置的后端环境 |

Vite 项目用 Vitest 最省事，它复用 Vite 的配置和转换管道，API 和 Jest 基本兼容。

### Testing Library：测试越像用户的使用方式越可信

- **查询元素**优先用 `getByRole`（按钮、标题、输入框）和 `getByLabelText`，然后才是 `getByText`，`getByTestId` 作为最后的选择。按角色查询还能顺带检查可访问性
- **交互**用 `@testing-library/user-event`，它会模拟真实的事件序列（点击前先触发 pointerdown、mousedown 等），比直接派发单个事件更接近真实
- **异步**：`findBy*` 会等待元素出现，`queryBy*` 找不到时返回 `null`，用来断言"某个元素不存在"
- **不测实现细节**：不去读组件内部的 state、不断言调用了哪个私有方法。重构内部实现而界面行为不变时，测试不应该失败

### 用 MSW mock 网络请求

直接 mock `fetch` 或 axios，测试就和"用哪个请求库"绑在了一起。MSW 在网络层拦截请求：Node.js 中拦截底层的请求模块，浏览器中通过 Service Worker 拦截。同一套 handler 可以同时用于单元测试、组件测试和本地开发。在单个用例中用 `server.use()` 覆盖默认 handler，就能测出错、空数据、超时等分支。

### 覆盖率的意义和局限

Vitest 用 `vitest run --coverage` 生成覆盖率报告（需要安装 `@vitest/coverage-v8` 或 `@vitest/coverage-istanbul`），看行、分支、函数、语句四项。

- 有用的地方：找出完全没有测试的模块和没走到的分支，例如错误处理
- 局限：代码被执行过不等于被验证过，一个没有断言的测试也能把覆盖率拉满；为了冲覆盖率写的测试往往在测实现细节
- 实践：对核心模块设置一个合理的门槛，防止覆盖率下降，不追求 100%

### 哪些东西值得测

- 值得测：核心业务逻辑（价格计算、权限判断）、容易出错的边界（空数据、出错、并发）、修过的 bug（加一条回归测试防止复发）、公共组件和工具函数
- 性价比低：纯展示的静态页面、第三方库本身的功能、样式和像素细节（交给视觉回归测试或人工验收）、频繁变化的原型页面

## 代码示例

Vitest + Testing Library + MSW 测试一个会请求接口的组件。`vitest.config.js` 中配置 `test: { environment: 'jsdom', setupFiles: ['./test/setup.js'] }`：

```js
// test/server.js：默认 handler，用例里可以 import 后用 server.use 覆盖
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export const server = setupServer(http.get('/api/user', () => HttpResponse.json({ name: '张三' })))

// test/setup.js
import '@testing-library/jest-dom/vitest' // 扩展 toBeInTheDocument 等断言
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })) // 漏 mock 的请求直接报错
afterEach(() => {
  server.resetHandlers() // 撤销单个用例里用 server.use 加的 handler
  cleanup()
})
afterAll(() => server.close())
```

```jsx
// src/UserCard.test.jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, it } from 'vitest'
import { server } from '../test/server.js'
import { UserCard } from './UserCard.jsx'

it('加载后显示用户名，点击关注后按钮文字改变', async () => {
  const user = userEvent.setup()
  render(<UserCard />)
  expect(await screen.findByRole('heading', { name: '张三' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '关注' }))
  expect(screen.getByRole('button', { name: '已关注' })).toBeInTheDocument()
})

it('接口出错时显示错误提示', async () => {
  server.use(http.get('/api/user', () => new HttpResponse(null, { status: 500 })))
  render(<UserCard />)
  expect(await screen.findByRole('alert')).toHaveTextContent('加载失败')
})
```

`UserCard` 在 `useEffect` 里请求 `/api/user`：成功时渲染 `h2` 标题和"关注"按钮，`res.ok` 为 false 时渲染 `role="alert"` 的错误提示。同样的流程用 Playwright 在真实浏览器里测：

```js
// e2e/user.spec.js
import { test, expect } from '@playwright/test'

test('用户可以关注', async ({ page }) => {
  await page.route('**/api/user', (route) => route.fulfill({ json: { name: '张三' } }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '张三' })).toBeVisible()
  await page.getByRole('button', { name: '关注' }).click()
  await expect(page.getByRole('button', { name: '已关注' })).toBeVisible()
})
```

## 面试官可能追问

::: details E2E 测试不稳定（时好时坏）怎么办？
常见原因是写死了等待时间、依赖了共享的测试数据、用例之间互相影响。Playwright 的定位器操作和 `expect` 断言会自动等待和重试，不要用固定的 `waitForTimeout`。每个用例自己准备和清理数据，或者用 `page.route` mock 掉不稳定的第三方接口。失败时保留截图、录像和 trace，方便复现。
:::

::: details 为什么不推荐测组件的内部 state？
内部 state 是实现细节，同样的界面行为可以用不同的 state 结构实现。测试绑定了内部结构，重构时界面没变、测试却大面积失败，大家就会对测试失去信任；反过来，state 对了但渲染写错了，这样的测试也发现不了。断言用户能看到和操作的结果，测试才既稳定又有意义。
:::

::: details jsdom 和真实浏览器有什么区别？什么时候需要真实浏览器？
jsdom 是用 JavaScript 实现的 DOM，不做布局和渲染：元素没有真实的尺寸和位置，`IntersectionObserver`、`ResizeObserver`、Canvas 等不支持或需要 mock。测拖拽、滚动、布局相关的逻辑，或者依赖浏览器 API 的组件时，用 Vitest 的浏览器模式或 Playwright 的组件测试，在真实浏览器里运行。
:::

## 易错点

- 用 `getByTestId` 或 CSS 类名查找元素，测试和实现绑死，也测不出可访问性问题
- 断言异步渲染的内容时用了 `getBy*`，元素还没出现测试就失败了，应该用 `findBy*`
- 把覆盖率当作质量指标，为了数字写没有断言的测试
- 所有场景都用 E2E 覆盖，CI 越来越慢、越来越不稳定，最后大家选择跳过测试
