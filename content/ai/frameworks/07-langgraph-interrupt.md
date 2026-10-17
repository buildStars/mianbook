---
difficulty: 2
tags: [实践, 场景题]
---

# LangGraph 怎么做人工介入？interrupt 暂停、审批和修改中间结果怎么实现？

::: tip 一句话回答
在节点里调用 `interrupt(payload)`，图会在这里**暂停**，把 payload 通过结果里的 `__interrupt__` 交给调用方；人处理完后，用同一个 `thread_id` 调用 `graph.invoke(Command(resume=人的输入), config)`，`interrupt()` 就返回这个输入，节点继续往下跑。暂停期间状态靠 **checkpointer** 保存，所以必须配 checkpointer。要注意恢复时**节点会从头重新执行**，`interrupt` 之前的代码会再跑一遍。
:::

## 详细解析

什么时候该让人介入、审批粒度怎么定这些设计原则见 [人在回路](/ai/agent/11-human-in-the-loop)，这里讲 LangGraph 的实现。

### 暂停和恢复的流程

1. 节点执行到 `interrupt(payload)`，内部抛出一个特殊信号，图停下
2. checkpointer 保存当前状态，`invoke` 返回，结果里带 `__interrupt__`，里面是 payload
3. 调用方把 payload 展示给人（审批页、聊天框），这期间可以过几分钟也可以过几天，不占进程
4. 人给出决定后，调用方用同一个 `thread_id` 传 `Command(resume=value)`
5. LangGraph 从该节点**开头**重新执行，这次执行到 `interrupt()` 时直接返回 `value`

payload 要能 JSON 序列化，一般放"要审批的内容 + 可选操作"，例如工具名、参数、说明。

### 三种常见用法

| 场景 | 做法 |
| --- | --- |
| 审批 | `interrupt` 返回 true/false，节点据此返回 `Command(goto="执行")` 或 `Command(goto="取消")` |
| 编辑中间结果 | 把草稿作为 payload，人修改后作为 resume 值传回，节点把它写回状态 |
| 补充信息 | 模型缺参数时问用户，resume 值就是用户的回答 |

审批工具调用时，可以把 `interrupt` 放进工具函数里：resume 值带上"批准 / 拒绝 / 修改后的参数"，批准就用原参数执行，修改就用新参数执行，拒绝就返回一条说明给模型。

除了让人通过 resume 改，也可以在暂停时调用 `graph.update_state(config, values)` 直接改状态，再恢复执行，原理见 [checkpointer](/ai/frameworks/06-langgraph-checkpointer)。

### 恢复时节点从头重跑

这是最容易踩的坑。`interrupt` 不是"挂起协程"，而是抛出信号中止节点；恢复时整个节点重新执行，只是这次 `interrupt()` 有了返回值。由此带来几条规则：

- `interrupt` 之前的副作用会执行两次。写库、发消息放到 `interrupt` 之后，或者拆成单独的节点，或者做成幂等
- 不要用裸的 `try/except` 包住 `interrupt`，会把暂停信号吞掉
- 一个节点里有多个 `interrupt` 时，按调用顺序和 resume 值对应，所以调用顺序要固定，不能依赖随机条件跳过
- 需要反复校验输入时，不要在节点里写 `while True` 循环调用 `interrupt`，而是一次 `interrupt` 后用条件边把不合格的情况路由回这个节点

### 静态断点

编译时传 `interrupt_before=["节点名"]` 或 `interrupt_after=[...]`，在指定节点前后固定暂停，`invoke(None, config)` 继续。它适合调试时单步观察，业务上的审批更推荐在节点里用 `interrupt`，可以带 payload、按条件决定要不要暂停。

## 代码示例

```python
from typing import Literal, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.memory import InMemorySaver

class State(TypedDict):
    email: str

def review(state: State) -> Command[Literal["send", "__end__"]]:
    # 这行之前不要放副作用：恢复时整个节点会重跑
    decision = interrupt({"draft": state["email"], "options": ["approve", "edit", "reject"]})
    if decision["action"] == "approve":
        return Command(goto="send")
    if decision["action"] == "edit":
        return Command(update={"email": decision["text"]}, goto="send")
    return Command(goto=END)

def send(state: State):
    print("发送：", state["email"])  # 真正的副作用放在审批之后
    return {}

builder = StateGraph(State)
builder.add_node("review", review)
builder.add_node("send", send)
builder.add_edge(START, "review")
builder.add_edge("send", END)
graph = builder.compile(checkpointer=InMemorySaver())

config = {"configurable": {"thread_id": "mail-1"}}
result = graph.invoke({"email": "周五开会"}, config)
print(result["__interrupt__"])  # 交给前端展示

graph.invoke(Command(resume={"action": "edit", "text": "周五下午三点开会"}), config)
```

## 面试官可能追问

::: details 为什么 interrupt 一定要 checkpointer？
暂停后 `invoke` 已经返回，进程可能早就处理别的请求了，甚至重启了。恢复时要知道"停在哪个节点、当时状态是什么"，这些都存在 checkpoint 里，按 `thread_id` 找回来。没有 checkpointer 就没地方存，无法恢复。
:::

::: details 并行的两个分支都触发了 interrupt，怎么恢复？
结果里会有多个 interrupt，每个带 id。恢复时可以传一个"interrupt id 到 resume 值"的映射给 `Command(resume=...)`，一次把所有暂停都答复掉。前端要把这几项审批一起展示。
:::

::: details 用户很久不处理审批怎么办？
图本身不会超时，状态一直留在 checkpoint 里。超时策略在业务层做：记录暂停时间，到期后由定时任务用 `Command(resume={"action": "reject"})` 之类的默认决定恢复，或者直接标记会话过期并清理快照。
:::

::: details interrupt 和 interrupt_before 有什么区别？
`interrupt` 写在节点代码里，可以按条件触发（比如金额超过阈值才审批），能带 payload，恢复值直接回到代码里。`interrupt_before` 是编译时配置的固定断点，每次都停，不带业务信息，适合调试。
:::

## 易错点

- 在 `interrupt` 之前写库或调用外部接口：恢复时节点重跑，副作用执行两次
- 恢复时换了 `thread_id` 或者重新传了初始输入：应该同一个 `thread_id`，传 `Command(resume=...)`
- 用 `try/except Exception` 包住 `interrupt`：暂停信号被吞，图不会停
- 把函数、类实例放进 payload：payload 要能序列化
