---
difficulty: 3
tags: [对比, 实践]
---

# 用 LangGraph 怎么搭多 Agent 系统？supervisor 和 handoff 有什么区别？

::: tip 一句话回答
在 LangGraph 里，每个 Agent 是图里的一个节点（通常是一个子图，例如 `create_agent` 建出来的 Agent）。**supervisor** 是集中式：一个主 Agent 负责理解任务和分派，子 Agent 被包装成工具或节点，干完活把结果交回主 Agent。**handoff** 是接力式：当前 Agent 调用一个"转交"工具，返回 `Command(goto=另一个 Agent, update=..., graph=Command.PARENT)`，把控制权和状态直接交出去，之后由新 Agent 和用户对话。前者控制强、上下文隔离好，后者调用次数少、适合多轮对话。
:::

## 详细解析

多 Agent 协作模式的概念和"什么时候真的需要多 Agent"见 [多 Agent 协作](/ai/agent/05-multi-agent)，这里讲在 LangGraph 里怎么落地。图、状态、`Command` 的基础见 [状态、节点和边](/ai/frameworks/05-langgraph-state)。

### 子图作为 Agent

一个 Agent 自己就是一张小图（模型节点 + 工具节点 + 循环）。放进多 Agent 系统有两种接法：

- **直接作为节点**：`builder.add_node("sales", sales_agent)`，父图和子图共享同名的状态字段（通常是 `messages`）
- **包在节点函数或工具里**：函数里调用 `sales_agent.invoke(...)`，自己决定传什么进去、取什么出来。状态结构不同、想隔离上下文时用这种

### supervisor：集中路由

```text
            ┌──────────────┐
  用户 ───▶ │  supervisor   │ ◀── 结果汇总
            └──┬───────┬───┘
       调用工具 │       │ 调用工具
          ┌────▼──┐ ┌──▼─────┐
          │ 研究   │ │ 写作    │   子 Agent 只看到分派给它的任务
          └───────┘ └────────┘
```

常见写法是把子 Agent 包成工具：主 Agent 调用 `research(query)`，工具里运行子 Agent，只把最终回答返回。所有路由都经过主 Agent，它能统筹多个子任务、合并结果、决定何时结束。子 Agent 不直接和用户说话。

过去有一个专门的 supervisor 库提供 `create_supervisor`，官方文档已说明它不再积极维护，推荐用上面"子 Agent 当工具"的方式自己搭。

### handoff：控制权转交

handoff 工具在子图内部被调用，但要跳到父图里的另一个节点，所以返回的 `Command` 要带 `graph=Command.PARENT`。还要补一条 `ToolMessage` 回应这次工具调用，并把发起调用的那条 `AIMessage` 一起放进 update（子图里的消息不会自动带到父图），否则父图的消息历史里工具调用和结果对不上，下一次调模型会出错。

一般在状态里记一个 `active_agent` 字段，下一轮用户发消息时，从 `START` 用条件边直接路由到当前负责的 Agent，不用每次再从头分派。

### 两者对比

| 维度 | supervisor（子 Agent 当工具） | handoff |
| --- | --- | --- |
| 控制 | 集中，主 Agent 说了算 | 分散，当前 Agent 决定交给谁 |
| 上下文 | 子 Agent 只拿到任务描述，隔离好 | 通常共享消息历史，新 Agent 看到全部对话 |
| 调用次数 | 每次都经过主 Agent，多一两次模型调用 | 转交后直接处理，后续轮次更省 |
| 和用户对话 | 只有主 Agent 面对用户 | 当前 Agent 直接和用户多轮交流 |
| 并行 | 主 Agent 可以同时派多个子任务 | 同一时间只有一个 Agent 在处理 |
| 典型场景 | 研究报告、多步骤任务拆解 | 客服分流：前台转售前、售后 |

### 共享状态还是各自状态

- **共享 `messages`**：实现简单，接手的 Agent 知道前情；代价是上下文越来越长，每个 Agent 都在为别人的工具调用细节付 token
- **各自状态**：子 Agent 用自己的 schema，父图只接收摘要或结论。上下文干净、成本可控，代价是要设计好"交接时传什么"
- 折中：handoff 时只转交最后一条 AI 消息和必要的结构化字段，而不是整段历史

## 代码示例

handoff 工具（放在销售 Agent 之外的某个 Agent 的工具列表里）：

```python
from langchain.tools import tool, ToolRuntime
from langchain.messages import AIMessage, ToolMessage
from langgraph.types import Command

@tool
def transfer_to_sales(runtime: ToolRuntime) -> Command:
    """用户要买东西时，转给销售 Agent。"""
    # 子图里的消息不会自动带到父图，要把发起这次调用的 AIMessage 一起交出去
    last_ai = next(m for m in reversed(runtime.state["messages"]) if isinstance(m, AIMessage))
    ack = ToolMessage(content="已转给销售", tool_call_id=runtime.tool_call_id)
    return Command(
        goto="sales_agent",                 # 父图里的节点名
        update={"active_agent": "sales_agent", "messages": [last_ai, ack]},
        graph=Command.PARENT,               # 跳出当前子图，在父图里路由
    )
```

## 面试官可能追问

::: details 多 Agent 一定比单 Agent 好吗？
不一定。多一个 Agent 就多一层调用和交接，延迟、成本和出错点都会增加。工具不多、领域单一时，一个 Agent 加清晰的提示词往往更好。拆分的理由应该是上下文装不下、不同团队分别维护、或者需要并行。
:::

::: details 怎么防止 Agent 之间来回踢皮球？
在状态里记录转交次数或转交路径，超过上限就路由到兜底节点或转人工；每个 handoff 工具的描述写清适用范围，避免两个 Agent 都觉得"这不归我"；再加上 `recursion_limit` 作为最后的保险。
:::

::: details 子 Agent 也要人工审批怎么办？
子图里照样可以调用 `interrupt`，暂停会一路冒泡到最外层调用方，恢复时用同一个 `thread_id` 传 `Command(resume=...)`。父图配置了 checkpointer 即可，子图会跟着持久化，见 [interrupt](/ai/frameworks/07-langgraph-interrupt)。
:::

::: details 怎么调试多 Agent 的执行过程？
用 `stream` 按步骤输出每个节点的更新，能看到每次路由去了哪个 Agent；配合 checkpointer 的 `get_state_history` 回看每一步状态。生产上接入链路追踪平台，按 thread 看完整调用树和每个 Agent 的 token 消耗。
:::

## 易错点

- handoff 工具忘了带 `graph=Command.PARENT`：跳转发生在子图内部，找不到目标节点
- 转交时不补 `ToolMessage`，或者没把发起调用的 `AIMessage` 一起带到父图：工具调用和结果对不上，后续模型调用报错
- 所有 Agent 共享完整消息历史却不控制长度：成本随 Agent 数量叠加
- 把 supervisor 当成"必须用某个专门库"：本质就是主 Agent 加子 Agent 工具，用基础 API 就能搭
