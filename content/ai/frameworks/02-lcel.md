---
difficulty: 2
tags: [原理, 实践]
---

# LCEL 是什么？用管道组合链有什么好处？

::: tip 一句话回答
LCEL（LangChain Expression Language）是用 `|` 把 Runnable 串起来的组合写法：`prompt | model | parser` 会生成一个 `RunnableSequence`。好处是组合出来的链**自动拥有** `invoke`、`stream`、`batch` 和异步接口，还能用 `RunnableParallel` 并行、`RunnablePassthrough` 透传、`with_fallbacks` 回退、`with_retry` 重试。逻辑复杂、有循环或大量分支时，直接写 Python 或用 LangGraph 更清楚。
:::

## 详细解析

### 管道是怎么工作的

`a | b` 返回一个新的 Runnable：调用它时先跑 `a`，把输出作为 `b` 的输入。因为每个组件都实现了同一套接口，序列本身也是 Runnable，可以继续往下拼，也可以当作另一条链的一步。

普通函数不能直接参与组合，用 `RunnableLambda(fn)` 包一下就行；在序列里直接写函数，框架也会自动包装。

### 并行、透传和分支

- **并行**：`RunnableParallel({"a": r1, "b": r2})` 把同一个输入同时交给多个 Runnable，输出一个字典。序列里直接写字典字面量，会被自动转成 `RunnableParallel`
- **透传**：`RunnablePassthrough()` 原样返回输入，常和并行一起用，比如 RAG 里一边检索文档、一边把原问题传下去；`RunnablePassthrough.assign(key=r)` 在保留原字典的同时追加一个新字段
- **分支**：`RunnableBranch` 按条件选一条子链。更常见的做法是写一个 `RunnableLambda`，在函数里判断条件并返回要执行的 Runnable

### 组合后自动获得的能力

| 能力 | 说明 |
| --- | --- |
| 流式 | 链里每步都支持流式时，最终片段会尽早吐出来 |
| 批量 | `batch` 默认用线程池并发执行，可在 config 里用 `max_concurrency` 限流 |
| 异步 | `ainvoke` / `astream` 不用另写一套代码 |
| 可观测 | 每一步的输入输出都能被回调和追踪工具记录下来 |

### 回退和重试

- `model.with_retry(stop_after_attempt=3)`：失败时自动重试，适合网络抖动、限流这类临时错误
- `primary.with_fallbacks([backup])`：主链抛异常就换备用链，比如主模型挂了换另一家

两者可以叠加：先在单个模型上重试几次，仍失败再回退。思路和 [Prompt 链](/ai/prompt/09-prompt-chaining) 里的多步拆分是一回事，LCEL 只是框架层的组合语法。

### 什么时候不用 LCEL

- 控制流复杂：多层条件、循环、需要根据中间结果反复调用，管道写起来很别扭
- 调试困难：长链出错时栈信息深，一段普通 Python 函数反而一眼能看懂
- 有状态、要中断恢复、要人工审批的流程，交给 [LangGraph](/ai/frameworks/04-langgraph-intro)

经验是：线性的"模板 → 模型 → 解析"和简单的 RAG 用 LCEL；其余直接写代码或用图。

## 代码示例

```python
from langchain.chat_models import init_chat_model
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough, RunnableLambda

model = init_chat_model("openai:your-model").with_retry(stop_after_attempt=3)
backup = init_chat_model("anthropic:your-model")  # 模型名换成实际的
llm = model.with_fallbacks([backup])

def fake_retrieve(q: str) -> str:
    return "闭包是函数和它引用的外部变量的组合。"  # 代替真实检索器

prompt = ChatPromptTemplate.from_template("根据资料回答。\n资料：{context}\n问题：{question}")

chain = (
    # 字典会被转成 RunnableParallel：两路同时执行
    {"context": RunnableLambda(fake_retrieve), "question": RunnablePassthrough()}
    | prompt
    | llm
    | StrOutputParser()
)

print(chain.invoke("什么是闭包？"))
for chunk in chain.stream("什么是闭包？"):
    print(chunk, end="")
```

## 面试官可能追问

::: details RunnableParallel 是真的并行吗？
同步调用时用线程池并发执行各分支，异步调用时用 asyncio 并发。对调用模型、检索这种 I/O 密集的分支，耗时接近最慢的那一路，而不是各路相加。
:::

::: details with_fallbacks 什么情况下会触发？
主 Runnable 抛出异常时触发，默认针对所有异常，也可以指定只对某些异常类型回退。模型"答得不好"不会触发回退，因为没有异常，这种情况要靠校验逻辑自己判断。
:::

::: details 为什么流式输出有时候不生效？
链里某一步需要完整输入才能处理，比如一个普通函数要拿到整段文本再加工，它会等上游全部输出完才继续，后面的流式就失效了。可以把这一步放到最后，或者改写成能逐块处理的生成器函数。
:::

## 易错点

- 以为 `|` 是 Python 内置能力：它是 Runnable 重载的运算符，两边至少有一个是 Runnable 才行
- 并行分支的输出是字典，下游组件的输入要对得上这些键名，提示模板的变量名写错会直接报错
- 把业务分支、循环全写进 LCEL，链越来越长、越来越难调试；该写函数就写函数
