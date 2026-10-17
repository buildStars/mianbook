---
difficulty: 2
tags: [实践, 场景题]
---

# E2E 测试怎么写才稳定？等待、数据隔离和不稳定的测试怎么处理？

::: tip 一句话回答
E2E 不稳定的主要原因是**时序、共享数据和外部依赖**。对应的做法：用**等待状态**代替固定 `sleep`，断言写成会自动重试的形式；选择器用角色、文本或 `data-testid`，不依赖样式类名；**每个用例自己造数据、自己清理**，用例之间互不依赖；第三方服务 mock 掉或用隔离环境。不稳定的测试要统计、隔离并限期修复，重试只用来止血，失败时保存截图、录像和 trace 方便排查。
:::

## 详细解析

### 等待：等状态，不等时间

`sleep(2000)` 有两个问题：机器慢时 2 秒不够，机器快时白等 2 秒。应该等一个具体的条件出现。

以 Playwright 为例：

- **操作自动等待**：`click` 之前会等元素可见、稳定、能接收事件、处于启用状态；`fill` 之前会等元素可见、启用、可编辑，不用手动等
- **断言自动重试**：`await expect(locator).toHaveText('已保存')` 会反复检查，直到满足或超时；而先 `await locator.textContent()` 再用普通断言比较，只检查一次，页面还没更新就失败
- **等网络**：需要时用 `page.waitForResponse` 等某个接口返回，而不是等固定时间

### 选择器：跟着用户看到的东西走

稳定程度大致是：角色和可访问名称（`getByRole('button', { name: '提交' })`）、`data-testid` 比较稳；CSS 类名和 DOM 层级（`div > div:nth-child(3)`）最脆，改个样式就挂。按角色选还顺带检验了可访问性。

### 数据隔离

用例共享一个账号、一份数据，最容易出现"单独跑能过，一起跑就挂"。

1. 每个用例通过接口或数据库直接造自己的数据，名字带随机后缀，避免并行时撞车
2. 不依赖其他用例的执行顺序和遗留数据
3. 用例结束清理，或者每次 CI 用全新的数据库
4. 登录这类准备工作通过接口完成，保存登录态复用，不在每个用例里点一遍登录页

Playwright 默认给每个测试一个全新的浏览器上下文，Cookie 和本地存储互不影响，这解决的是浏览器侧隔离，服务端数据仍要自己隔离。

### 外部依赖

支付、短信、第三方登录这类服务慢、有限流、偶尔挂，不应该决定你的测试结果。核心链路用 `page.route` 拦截请求返回固定数据，或者在测试环境接 mock 服务；真正和第三方的联调放到少量专门的契约测试或冒烟测试里。

### 不稳定测试的处理

- **识别**：CI 开启失败重试，第一次失败、重试通过的就是不稳定测试，Playwright 报告里会标成 flaky。持续统计每个用例的不稳定率
- **隔离**：不稳定率高的用例移出阻塞合并的门禁，单独跑，并建任务指定负责人
- **重试的边界**：重试一两次可以吸收偶发抖动，但会掩盖真实的并发 bug。重试通过不等于没问题，要看统计
- **保存现场**：失败时留截图、录像和 trace，trace 能回放每一步操作前后的 DOM、网络和控制台，比看日志快得多

E2E 和单测、组件测试的分工见 [前端测试分层](/basics/build/15-frontend-testing)，本题只讲 E2E 自身的稳定性。

## 代码示例

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  retries: process.env.CI ? 2 : 0,      // 只在 CI 上重试
  use: {
    trace: 'on-first-retry',            // 第一次重试时录 trace
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
```

```ts
// order.spec.ts
import { test, expect } from '@playwright/test'

test('提交订单后显示成功', async ({ page, request }) => {
  // 通过接口造本用例专用的数据
  const name = `商品-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  await request.post('/api/test/products', { data: { name, stock: 1 } })

  // 第三方支付用固定响应代替
  await page.route('**/api/pay', (route) => route.fulfill({ json: { ok: true } }))

  await page.goto('/shop')
  await page.getByRole('link', { name }).click()
  await page.getByRole('button', { name: '立即购买' }).click()
  await expect(page.getByText('下单成功')).toBeVisible()   // 自动重试，不用 sleep
})
```

## 面试官可能追问

::: details 本地能过，CI 上老挂，怎么排查？
先看 trace 和截图，确认挂在哪一步。CI 机器通常更慢、并行度更高、屏幕尺寸和时区可能不同，常见原因是隐式依赖了时序、共享数据，或者依赖本地环境的配置。可以本地用相同并行数、重复多次跑来复现。
:::

::: details 动画、懒加载导致点不到元素怎么办？
测试环境可以关闭动画，比如开启减少动态效果的设置。懒加载内容先滚动到可见，再用断言等它出现。不要用强制点击跳过可操作性检查，那会掩盖真实的用户体验问题。
:::

::: details E2E 用例写多少合适？
只覆盖最核心的用户路径，比如注册、下单、支付。E2E 慢、维护成本高，能用单测或组件测试覆盖的逻辑就不要放到 E2E。
:::

## 易错点

- 先读出文本再普通断言，失去了自动重试，比 `expect(locator)` 更容易抖
- 以为浏览器上下文隔离了就万事大吉，服务端数据还是共享的
- 把重试次数调得很大让流水线变绿，真实的竞态 bug 被藏起来
