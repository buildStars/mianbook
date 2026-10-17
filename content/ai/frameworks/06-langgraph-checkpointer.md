---
difficulty: 3
tags: [原理, 实践]
---

# LangGraph 的 checkpointer 有什么用？断点恢复和回溯历史状态是怎么实现的？

::: tip 一句话回答
checkpointer 在图**每执行完一个 super-step 就把状态存一份快照**（checkpoint），按 `thread_id` 归到一个会话下。有了它，同一个 thread 再次调用就能接着上次的状态跑（多轮对话、断点恢复），`interrupt` 人工介入也靠它。还能用 `get_state_history` 翻出历史快照，从某一步**重放**或用 `update_state` 改状态后**分叉**重跑，也就是 time travel。
:::

## 详细解析

框架无关的持久化思路（为什么要存、存什么、幂等）见 [持久化 Agent](/ai/agent/14-durable-agent)，这里讲 LangGraph 的具体机制。

### 快照是怎么产生的

LangGraph 按 super-step 执行：同一步里可以并行的节点一起跑，跑完合并状态，再进入下一步。编译时传入 checkpointer 后，每一步结束都会写一个 checkpoint，里面有：

- 当时的状态值（`values`）
- 下一步要执行哪些节点（`next`）
- 这个快照的配置，包含 `thread_id` 和 `checkpoint_id`（`config`）
- 元数据，例如这一步是哪个节点写的（`metadata`）

同一步里某个并行节点成功、另一个失败时，成功节点的写入会作为 pending writes 先存下来，恢复时不用重跑已成功的节点。

### thread_id：会话的边界

调用时在 `config` 里传 `{"configurable": {"thread_id": "..."}}`。同一个 `thread_id` 共享一条快照链，换一个 id 就是全新的会话。所以多用户系统里 `thread_id` 通常绑定"用户 + 会话"，不能写死，否则不同用户会读到彼此的状态。

跨会话的长期记忆（比如用户偏好）不放在 checkpointer，而是放 store，checkpointer 只管单个 thread 内的状态。

### 断点恢复

进程崩了、请求超时、或者 `interrupt` 暂停了，只要 checkpoint 在，用同一个 `thread_id` 再调用就能续上：

- 遇到 `interrupt` 暂停的，用 `Command(resume=...)` 恢复
- 因异常中断的，`graph.invoke(None, config)` 从最后一个 checkpoint 继续，已完成的步骤不会重跑

### 查看历史和 time travel

- `graph.get_state(config)`：当前最新快照
- `graph.get_state_history(config)`：所有历史快照，**最新的在前**
- **重放**：拿到某个历史快照的 `config`（带 `checkpoint_id`），`graph.invoke(None, 那个 config)`。之前的步骤不重跑，之后的节点**会重新执行**，模型调用和接口请求都会再发一次，结果可能不同
- **分叉**：`graph.update_state(历史 config, values={...})` 在那个点上生成一个新的 checkpoint，返回新 config，再 `invoke(None, 新 config)` 沿新分支跑。原来的历史保留不动

这个能力适合调试（"第 3 步换个检索结果会怎样"）和让用户"改一下上一步再继续"。

### 存储怎么选

| 实现 | 场景 |
| --- | --- |
| `InMemorySaver` | 本地开发、测试，进程重启就没了 |
| `SqliteSaver` | 单机、小工具，文件存储 |
| `PostgresSaver` 等数据库实现 | 生产环境，多实例共享、能扛重启 |

数据库版本在独立的包里，首次使用要调用 `setup()` 建表。每一步都写快照，长对话的快照会很多，要规划清理策略。

### 和有副作用的节点配合

恢复和重放都会让节点再执行一次，节点粒度是"重跑单位"。发邮件、扣款这类操作：

- 单独放一个节点，前面的步骤失败不会把它带着重跑
- 做成幂等，例如带上业务唯一键，下游去重
- 重放调试时，对副作用节点用测试替身

## 代码示例

```python
from langgraph.checkpoint.memory import InMemorySaver

graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "user-42:chat-1"}}

graph.invoke({"messages": [{"role": "user", "content": "我叫小王"}]}, config)
graph.invoke({"messages": [{"role": "user", "content": "我叫什么？"}]}, config)  # 记得上一轮

# 翻历史：最新的在前，找到"即将执行 agent 节点"的那个快照
history = list(graph.get_state_history(config))
target = next(s for s in history if s.next == ("agent",))

# 分叉：改状态后从那里重跑，原历史不受影响
fork_config = graph.update_state(target.config, values={"messages": [{"role": "user", "content": "我叫小李"}]})
graph.invoke(None, fork_config)
```

## 面试官可能追问

::: details checkpointer 和 store 有什么区别？
checkpointer 存的是某个 thread 的图状态快照，生命周期跟着这个会话，用来续跑和回溯。store 是跨 thread 的键值存储，存用户偏好、长期记忆这类和单次会话无关的数据。一个用户开多个会话，偏好放 store，各会话的对话进度放 checkpointer。
:::

::: details 重放从历史快照开始，之前的节点会重新执行吗？
不会。指定 checkpoint 之前的步骤直接用存好的状态，只有之后的节点重新执行。所以重放不是"免费回看"，后面的模型调用、外部请求都会真实发生一次。
:::

::: details 生产环境多实例部署要注意什么？
用数据库类的 checkpointer，所有实例读写同一份数据，请求落到哪个实例都能续上。同一个 `thread_id` 不要并发执行两次，否则两次写入会互相覆盖，一般在业务层对 thread 加锁或排队。快照会持续增长，按会话过期时间清理。
:::

::: details 状态里能放什么类型的数据？
要能被 checkpointer 序列化：字符串、数字、列表、字典、消息对象、Pydantic 模型等。数据库连接、文件句柄这类对象不该进状态，通过节点外部的依赖注入获取。
:::

## 易错点

- 只编译了 checkpointer 却不传 `thread_id`：没有 thread 就无从保存和恢复
- 以为 time travel 是"回看录像"：从历史点继续时后面的节点会真实重跑，副作用也会再发生
- 用 `InMemorySaver` 上生产：重启丢状态，多实例之间也不共享
- 以为 `update_state` 会改写历史：它是在那个点上新建一个分支 checkpoint，原历史还在
