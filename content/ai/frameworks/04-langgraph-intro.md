---
difficulty: 1
tags: [高频, 对比]
---

# LangGraph 是什么？和 LangChain 是什么关系？为什么要用图来编排？

::: tip 一句话回答
LangGraph 是一个**有状态的 Agent 编排框架**：把流程画成图，节点是步骤，边决定下一步，所有节点读写同一份**状态**。和固定的链相比，图天然能表达**循环、条件分支**，配合 checkpointer 还能**持久化、断点恢复和人工介入**。LangChain 提供模型、工具等组件和预置 Agent（`create_agent` 就构建在 LangGraph 之上）；LangGraph 负责编排，也可以不依赖 LangChain 单独使用。
:::

## 详细解析

### 链的局限

LCEL 链是一条有向无环的管道，数据从头流到尾。真实的 Agent 经常需要：

- **循环**：调模型 → 调工具 → 再调模型，次数事先不知道
- **分支**：根据模型输出走不同路径，比如"需要检索"和"直接回答"
- **长时间运行**：任务跑几分钟甚至几小时，中途可能失败，要能接着跑
- **人工介入**：执行危险操作前暂停，等人审批后再继续

这些用链很难写，要么塞进一个大函数里，要么自己维护一堆状态变量。

### 用图表示状态机

LangGraph 把 Agent 看成状态机：

```text
       ┌──────────┐
START →│  call_llm │──无工具调用──→ END
       └────┬─────┘
            │ 有工具调用
            ▼
       ┌──────────┐
       │ run_tools │──→ 回到 call_llm
       └──────────┘
```

- **状态（State）**：一个共享的数据结构，比如消息列表，所有节点都读写它
- **节点（Node）**：普通函数，接收当前状态，返回要更新的字段
- **边（Edge）**：固定边表示"做完 A 必做 B"；**条件边**由一个路由函数读状态决定去哪
- 图执行时一步一步推进，每一步结束都可以存一次状态快照

状态、reducer 和条件边的设计细节见 [状态、节点和边](/ai/frameworks/05-langgraph-state)。

### LangGraph 和 LangChain 的分工

| | LangChain | LangGraph |
| --- | --- | --- |
| 定位 | 组件层：模型、消息、工具、检索器的统一接口，加上预置的 Agent | 编排层：状态、流程控制、持久化 |
| 典型用法 | `init_chat_model`、`@tool`、`create_agent` | `StateGraph`、条件边、checkpointer、interrupt |
| 能否单独用 | 依赖 LangGraph 运行 Agent | 可以，节点里调任何 SDK 都行 |

简单说：标准的工具调用 Agent 用 LangChain 的 `create_agent` 就够了；流程需要自定义时，直接用 LangGraph 搭图，节点里可以继续用 LangChain 的模型和工具。

### 图带来的能力

- **持久化**：编译时传 checkpointer，按 `thread_id` 保存每一步状态，崩溃后能接着跑，详见 [checkpointer](/ai/frameworks/06-langgraph-checkpointer)
- **人工介入**：在节点里暂停，等人确认或修改后恢复，详见 [interrupt](/ai/frameworks/07-langgraph-interrupt)
- **流式**：可以流式输出每一步的状态更新，也可以流式输出模型的 token
- **多 Agent**：每个 Agent 可以是图里的一个节点或子图，用 supervisor 或 handoff 组织协作

## 代码示例

```python
from langgraph.graph import StateGraph, MessagesState, START, END

def call_llm(state: MessagesState):
    # 真实场景这里调用模型；返回的字段会合并进状态
    return {"messages": [{"role": "ai", "content": "你好！"}]}

builder = StateGraph(MessagesState)
builder.add_node(call_llm)          # 节点名默认取函数名
builder.add_edge(START, "call_llm")
builder.add_edge("call_llm", END)
graph = builder.compile()

print(graph.invoke({"messages": [{"role": "user", "content": "hi"}]}))
```

## 面试官可能追问

::: details 什么场景不需要 LangGraph？
单次调用、固定步骤的流水线、简单 RAG，用 LCEL 或普通函数就够了。引入图会多出状态定义、编译这些概念，收益不抵成本。框架之间的选型见 [Agent 框架选型](/ai/agent/10-frameworks)。
:::

::: details 图里有循环，怎么防止死循环？
图执行有 `recursion_limit`，超出步数会抛 `GraphRecursionError`，可以在调用时通过 config 调小。业务上还应该在状态里记录轮数或在路由函数里设置退出条件，不能只靠兜底。
:::

::: details LangGraph 和工作流引擎（比如 Temporal）有什么不同？
两者都管状态和恢复。LangGraph 面向 LLM 应用，内置消息状态、流式 token、人工介入这些概念，上手快；通用工作流引擎在调度、重试、跨服务编排上更成熟。长任务的持久化思路见 [Agent 状态持久化](/ai/agent/14-durable-agent)。
:::

## 易错点

- 把 LangGraph 说成 LangChain 的替代品：它们是不同层次，经常一起用
- 以为节点要返回完整状态：节点只返回要更新的字段，怎么合并由状态的 reducer 决定
- 忘了 `compile()`：`StateGraph` 只是构建器，编译后得到的才是能 `invoke` 的图
