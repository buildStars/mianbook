---
difficulty: 2
tags: [实践]
---

# 已有的 REST 接口怎么改造成模型好用的工具？

::: tip 一句话回答
不要一个接口对应一个工具，而是**按用户任务聚合**：把模型完成一件事要调的几个接口包成一个工具。参数要**简化**，只暴露模型需要决定的，其余用默认值或由后端补齐；返回结果要**裁剪和可读化**，去掉内部字段，把编码转成文字。鉴权不交给模型，由服务端用当前用户的身份**透传**。
:::

## 详细解析

### 为什么不能直接照搬接口

REST 接口是给程序员和前端设计的，模型用起来有几个问题：

- **粒度太细**：查一个订单的物流，可能要先查订单、再查运单、再查轨迹，模型要连调三次，每一步都可能出错
- **参数太多**：分页、排序、字段筛选、内部 ID，模型不知道该填什么，容易乱填
- **返回太杂**：一个订单对象几十个字段，大部分和问题无关，还占上下文
- **含义不清**：状态码 `3`、字段 `ext_flag`，模型只能猜

### 从 OpenAPI 自动生成的问题

用 OpenAPI 文档一键生成工具很方便，但通常只能当起点：

- 接口有几十上百个，全塞给模型，选择准确率会下降，见 [工具太多怎么办](/ai/tools/10-many-tools)
- 文档里的描述是写给人看的，常常只有一句"获取列表"，没有"什么时候用"
- 参数照搬，内部参数也暴露出来
- 写操作和读操作混在一起，权限不好控制

比较稳的做法：自动生成后，按任务挑出一小组，手工改写名称、描述和参数。描述怎么写见 [工具描述](/ai/tools/03-tool-description)。

### 改造步骤

1. **列任务**：从真实用户问题出发，列出模型要完成的事，比如"查订单进度"、"申请退款"
2. **按任务聚合**：一个任务对应一个工具，内部再去调多个接口
3. **简化参数**：只留模型能从对话里得到的参数；用户 ID 从会话取，分页给默认值，枚举写清可选值
4. **裁剪结果**：只返回回答问题需要的字段；编码转成文字；时间转成可读格式；列表限制条数并说明总数
5. **统一错误**：把 HTTP 错误转成模型能理解的提示，比如"订单号不存在，请让用户核对"

### 代码示例

```js
// 模拟三个已有接口
const api = {
  getOrder: async (id) => ({ id, status: 3, ext_flag: 0, shipment_id: 'S1', created_at: 1760000000000 }),
  getShipment: async (sid) => ({ sid, carrier_code: 'SF', internal_route: 'R-88' }),
  getTracks: async (sid) => [
    { t: 1760100000000, desc: '已揽收' },
    { t: 1760200000000, desc: '运输中' },
    { t: 1760300000000, desc: '派送中' },
  ],
}

const STATUS = { 1: '待支付', 2: '待发货', 3: '已发货', 4: '已完成' }
const CARRIER = { SF: '顺丰' }
const fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

// 聚合后的工具：模型只需要给订单号
const getOrderProgress = {
  name: 'get_order_progress',
  description: '查询当前用户某个订单的状态和最新物流。用户问"我的订单到哪了"时使用。',
  parameters: {
    type: 'object',
    properties: { order_id: { type: 'string', description: '订单号' } },
    required: ['order_id'],
  },
  async run({ order_id }) {
    const order = await api.getOrder(order_id)
    const result = { 订单号: order.id, 状态: STATUS[order.status] ?? '未知' }
    if (order.shipment_id) {
      const [ship, tracks] = await Promise.all([
        api.getShipment(order.shipment_id),
        api.getTracks(order.shipment_id),
      ])
      result.快递公司 = CARRIER[ship.carrier_code] ?? ship.carrier_code
      // 只保留最近两条轨迹，内部字段不返回
      result.最新物流 = tracks.slice(-2).map((x) => `${fmt(x.t)} ${x.desc}`)
    }
    return result
  },
}

getOrderProgress.run({ order_id: 'A100' }).then((r) => console.log(JSON.stringify(r)))
// {"订单号":"A100","状态":"已发货","快递公司":"顺丰","最新物流":["2025-10-11 16:26 运输中","2025-10-12 20:13 派送中"]}
// 时间按 UTC 格式化，实际项目要按用户时区
```

### 鉴权透传

- 工具参数里**不要**出现 token、用户 ID，模型能填的参数就可能被注入篡改
- 工具执行层从当前会话里取用户凭证，用**用户自己的权限**调后端，而不是用一个大权限的服务账号
- 后端照常校验"这个订单是不是这个用户的"，不因为请求来自 AI 就放宽

写操作还要加确认和幂等，见 [工具权限设计](/ai/tools/09-tool-permissions) 和 [写操作幂等](/ai/tools/15-idempotent-tools)。

## 面试官可能追问

::: details 聚合工具会不会太死板，覆盖不了所有情况？
会有覆盖不到的长尾。常见的做法是核心任务做成聚合工具，再保留少量通用的查询工具兜底。看线上日志里模型调不到合适工具的问题，再决定是否新增聚合工具。
:::

::: details 改造后的工具和 MCP Server 是什么关系？
改造解决的是"工具长什么样"，MCP 解决的是"工具怎么暴露给不同的客户端"。改造好的工具可以直接注册在自己应用的工具列表里，也可以包成 [MCP Server](/ai/tools/08-mcp-server) 给多个客户端复用。
:::

::: details 返回结果用中文键名好还是英文键名好？
都可以，关键是含义清楚、全局一致。中文键名对中文对话更直观；英文键名便于前端和代码复用。不要一会中文一会英文，也不要用缩写。
:::

## 易错点

- 把 OpenAPI 生成的全部接口直接给模型，工具多、描述差，选择准确率反而下降
- 把用户 ID、token 放进工具参数，让模型来填
- 返回原始 JSON：状态码、内部字段原样给模型，模型只能猜含义
