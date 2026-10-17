---
difficulty: 2
tags: [原理, 实践]
---

# LangGraph 的状态、节点和边怎么设计？条件边和 reducer 怎么用？

::: tip 一句话回答
LangGraph 把流程画成一张图：**状态**是所有节点共享的一份数据，**节点**是"读状态、返回要改的那几个字段"的函数，**边**决定下一步去哪。普通边是固定跳转，**条件边**由路由函数看状态决定分支。每个字段可以用 `Annotated` 挂一个 **reducer**，规定新值怎么和旧值合并，比如消息列表用 `add_messages` 追加而不是覆盖。
:::

## 详细解析

图的基本概念（`StateGraph`、`compile`、`invoke`）见 [LangGraph 入门](/ai/frameworks/04-langgraph-intro)，这里讲怎么设计。

### 状态 schema：只放跨节点要用的数据

状态一般用 `TypedDict` 定义，也可以继承内置的 `MessagesState`（已经带好了 `messages` 字段和追加规则）。设计原则：

- **只放需要在节点之间传递的东西**：用户问题、消息历史、检索结果、当前步骤、重试次数。节点内部的临时变量留在函数里
- **字段要能序列化**：开了 checkpointer 后状态会被存下来，放数据库连接、客户端对象会出问题，这类依赖从外部注入
- **大对象存引用**：长文档、文件内容放到外部存储，状态里存 id，否则每一步快照都很大
- 字段名表达业务含义，例如 `retry_count`、`plan`，而不是 `data1`

### 节点：返回增量，不是整份状态

节点签名是 `def node(state) -> dict`，返回的 dict **只包含要更新的字段**，没返回的字段保持原样。LangGraph 拿返回值按每个字段的 reducer 合并到状态里。节点不要直接修改传进来的 `state` 对象，改了也不会按预期生效。

### 边：普通边、条件边、循环

| 写法 | 作用 |
| --- | --- |
| `add_edge(START, "a")` | 入口 |
| `add_edge("a", "b")` | a 执行完固定去 b |
| `add_conditional_edges("a", route, {...})` | a 执行完调用 `route(state)`，按返回值去对应节点 |
| `add_edge("b", END)` | 结束 |

路由函数只做判断，不改状态。返回值可以直接是节点名，也可以返回任意值再用第三个参数的映射表转成节点名。条件边可以指回前面的节点，这就形成了循环，Agent 的"调用模型 → 执行工具 → 再调用模型"就是这么画出来的。

如果节点既要更新状态又要决定去向，可以返回 `Command(update={...}, goto="b")`，相当于把条件边写进节点里。同一个节点不要既用 `Command` 路由又加静态边。

### reducer：字段怎么合并

没写 reducer 的字段，新值**覆盖**旧值。写了 reducer 的字段，用 `reducer(旧值, 新值)` 得到结果：

- `Annotated[list, operator.add]`：列表拼接
- `Annotated[list, add_messages]`：消息追加，并且按消息 id 更新已存在的消息
- 自定义函数：比如字典合并、取最大值、去重

reducer 在**并行分支**里最关键。一个节点连出两条边，两个分支在同一个 super-step 里并行执行，如果它们都写同一个没有 reducer 的字段，LangGraph 不知道听谁的，会直接报错（`InvalidUpdateError`）。给字段加上 reducer，两个结果就会被合并。

### 循环与终止

循环必须有出口：路由函数里检查"任务完成"或"重试次数到上限"，返回 `END`。另外 LangGraph 有 `recursion_limit`（最多执行多少个 super-step），超过会抛 `GraphRecursionError`，这是兜底，不能代替业务上的终止条件。

## 代码示例

```python
import operator
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END

class State(TypedDict):
    question: str
    drafts: Annotated[list[str], operator.add]  # 追加
    retry_count: int                             # 覆盖

def write(state: State):
    draft = f"第 {state['retry_count'] + 1} 版答案"
    # 只返回要改的字段
    return {"drafts": [draft], "retry_count": state["retry_count"] + 1}

def route(state: State) -> str:
    return "done" if state["retry_count"] >= 3 else "again"

builder = StateGraph(State)
builder.add_node("write", write)
builder.add_edge(START, "write")
builder.add_conditional_edges("write", route, {"again": "write", "done": END})
graph = builder.compile()

result = graph.invoke({"question": "什么是闭包", "drafts": [], "retry_count": 0})
print(len(result["drafts"]))  # 3
```

## 面试官可能追问

::: details 条件边和在节点里返回 Command 怎么选？
条件边把"做事"和"决定去哪"分开，图结构一眼能看清，适合路由逻辑简单、只依赖状态的情况。`Command` 适合"根据这一步的结果同时改状态并跳转"，比如多 Agent 里的 handoff。用 `Command` 时要给返回类型标注可能的目标节点（`Command[Literal["b", "c"]]`），否则画图时看不出这些边。
:::

::: details 怎么做 map-reduce，数量不固定的并行任务？
在条件边的路由函数里返回一组 `Send("节点名", 子状态)`，每个 `Send` 会启动一次该节点，各自带不同的输入。汇总字段要配 reducer（例如 `operator.add`），所有分支的结果才能拼到一起。
:::

::: details 状态里的消息越来越长怎么办？
`add_messages` 只会追加，历史会无限增长。常见做法是加一个总结节点，把早期消息压缩成摘要，再用 `RemoveMessage` 删除旧消息；或者调用模型前只取最近若干条。思路见 [长任务的上下文管理](/ai/agent/12-long-task-context)。
:::

::: details 为什么不把所有数据都塞进状态？
状态会在每一步被保存成快照，字段越多越大，存储和序列化成本越高；所有节点都能读写，也容易被无关节点误改。只在节点内部用的数据留在函数里，跨图共享的长期数据放到 store 或数据库。
:::

## 易错点

- 节点返回整份状态或者直接改 `state`：应该只返回要更新的字段
- 以为列表字段默认会追加：没有 reducer 就是覆盖，上一步的结果会被冲掉
- 并行分支写同一个没有 reducer 的字段会报错，不是"后写的赢"
- 靠 `recursion_limit` 结束循环：它是防死循环的保险，路由函数里要有明确的终止条件
