---
difficulty: 2
tags: [高频, 原理]
---

# LangChain 里的 Agent 是怎么工作的？工具怎么定义和调用？

::: tip 一句话回答
工具用 `@tool` 装饰普通函数来定义：**函数名**成为工具名，**docstring** 成为描述，**类型注解**生成参数 schema。现在推荐用 `create_agent(model, tools, system_prompt)` 创建 Agent，它底层是一个 LangGraph 图：调用模型 → 模型返回 `tool_calls` 就执行工具、把结果作为 `ToolMessage` 回填 → 再调模型，直到模型不再请求工具。旧的 `AgentExecutor` 已经不推荐了。
:::

## 详细解析

### 定义工具

`@tool` 把函数包装成一个工具对象，框架从函数本身读出模型需要的三样东西：

| 模型看到的 | 来自哪里 |
| --- | --- |
| 工具名 | 函数名，也可以 `@tool("web_search")` 指定 |
| 描述 | docstring，也可以用 `description=` 覆盖 |
| 参数 schema | 参数的类型注解和默认值；有默认值的参数是可选的 |

类型注解是必须的，没有它就生成不出参数 schema。参数复杂时，可以用 `args_schema` 传一个 Pydantic 模型，给每个字段写 `Field(description=...)`、用 `Literal` 限定取值。描述怎么写模型才能选对，见 [工具描述](/ai/tools/03-tool-description)。

### 模型绑定工具

不用 Agent 时，可以 `model.bind_tools([...])`：框架把工具转成厂商要求的格式随请求发出。模型如果决定调用，返回的 `AIMessage.tool_calls` 是一个列表，每项有 `name`、`args`、`id`。这时**执行工具、回传结果要自己写**。协议层的细节见 [Function Calling](/ai/tools/01-function-calling)。

### Agent 执行循环

`create_agent` 把这个循环封装好了：

1. 把系统提示、历史消息和工具 schema 一起发给模型
2. 模型返回带 `tool_calls` 的 `AIMessage`：逐个执行工具，每个结果包成 `ToolMessage`（带上对应的 `tool_call_id`）追加到消息列表
3. 回到第 1 步，让模型看到工具结果再决定下一步
4. 模型返回不带工具调用的普通回复，循环结束，这条回复就是最终答案

它和 [手写的 Agent 循环](/ai/agent/09-agent-loop) 是同一个思路，区别是状态存在图的 `messages` 里，可以加 checkpointer 做多轮对话和断点恢复，也可以用中间件在模型调用、工具调用前后插入逻辑。

### 步数上限和错误处理

- **步数上限**：图执行有 `recursion_limit`（按图的执行步数算），超出会抛 `GraphRecursionError`。业务上通常设得比默认值小很多，防止模型来回空转。框架还提供限制模型调用次数、工具调用次数的中间件
- **工具报错**：可以用 `wrap_tool_call` 中间件包住工具执行，异常时返回一条说明错误的 `ToolMessage`，让模型看到错误后换参数重试，而不是整个 Agent 崩掉。临时故障可以用重试中间件
- 错误处理的通用策略见 [工具调用出错](/ai/tools/05-tool-errors)

### 旧写法和现在的写法

旧写法是 `create_react_agent` / `create_tool_calling_agent` 加 `AgentExecutor`，循环逻辑写死在执行器里，用 `max_iterations` 限制步数。现在推荐 `from langchain.agents import create_agent`，原来 `langgraph.prebuilt` 里的 `create_react_agent` 也被它取代，参数 `prompt` 改名为 `system_prompt`。面试时能说清这个演进就够了。

## 代码示例

```python
from langchain.agents import create_agent
from langchain.tools import tool

@tool
def get_weather(city: str) -> str:
    """查询指定城市当前的天气。"""
    return f"{city}：晴，25 度"  # 演示用的假数据

agent = create_agent(
    model="openai:your-model",  # 换成实际的厂商和模型名
    tools=[get_weather],
    system_prompt="你是出行助手，回答要简短。",
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "北京今天适合跑步吗？"}]},
    config={"recursion_limit": 10},  # 限制最多执行的步数
)
print(result["messages"][-1].content)
```

`result["messages"]` 里能看到完整轨迹：用户消息、带 `tool_calls` 的 AI 消息、`ToolMessage`、最终回复。

## 面试官可能追问

::: details 模型一次返回多个 tool_calls 怎么办？
每个调用都要执行，并且每个都要有对应 `tool_call_id` 的 `ToolMessage`，缺一个下次请求厂商接口就会报错。互不依赖的调用可以并行执行，见 [并行工具调用](/ai/tools/04-parallel-calls)。
:::

::: details 工具需要当前用户 ID 这类信息，但不想让模型填，怎么做？
不要把它写成工具参数。LangChain 的工具可以声明一个 `runtime: ToolRuntime` 参数，从中读取 Agent 的状态和运行时上下文，这个参数不会出现在给模型的 schema 里。这样敏感信息由程序注入，模型改不了。
:::

::: details create_agent 和自己用 LangGraph 搭有什么区别？
`create_agent` 是预置好的"模型 + 工具"循环图，适合标准的工具调用 Agent。流程里有固定步骤、复杂分支或多个 Agent 协作时，用 LangGraph 自己定义节点和边，见 [LangGraph 入门](/ai/frameworks/04-langgraph-intro)。
:::

## 易错点

- 工具函数不写 docstring 或类型注解：描述为空、schema 生成不出来，模型不知道什么时候该用它
- 以为 Agent 会自动停：如果模型一直请求工具，就靠 `recursion_limit` 兜底，要主动设一个合理的上限
- 把 `AgentExecutor` 当成现在推荐的写法来答，会显得知识过时
- 工具抛异常不处理，一次失败就让整轮对话报错；应该把错误信息回填给模型
