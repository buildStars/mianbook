---
difficulty: 1
tags: [高频, 原理]
---

# LangChain 的核心抽象有哪些？模型、提示模板、输出解析器和 Runnable 分别是什么？

::: tip 一句话回答
LangChain 把一次 LLM 调用拆成几块可替换的积木：**聊天模型**负责收发消息，**提示模板**把变量填进固定的提示词，**输出解析器 / 结构化输出**把模型返回的文本变成程序能用的数据。它们都实现了 **Runnable** 接口，统一提供 `invoke`、`stream`、`batch`，所以能用 `|` 串成一条链。
:::

## 详细解析

### 聊天模型和消息

聊天模型的输入输出都是**消息列表**，不是一段字符串。常见消息类型：

| 类型 | 作用 |
| --- | --- |
| `SystemMessage` | 系统指令，设定角色和规则 |
| `HumanMessage` | 用户输入 |
| `AIMessage` | 模型回复，工具调用请求也放在它的 `tool_calls` 里 |
| `ToolMessage` | 工具执行结果，靠 `tool_call_id` 对应到某次调用 |

不同厂商的接口格式不一样，LangChain 用统一的消息类型和模型类把差异包起来。用 `init_chat_model("provider:model")` 这样的写法就能切换厂商，业务代码不用改。

### 提示模板

提示模板就是"带占位符的消息列表"。`ChatPromptTemplate.from_messages` 定义好系统消息、用户消息的结构，调用时传一个字典填变量，得到真正发给模型的消息。好处是提示词和代码分开，变量缺失会直接报错，不会悄悄发出半截提示。需要插入历史对话时，用 `MessagesPlaceholder` 占位。

### 输出解析器和结构化输出

模型返回的是 `AIMessage`。最简单的 `StrOutputParser` 只把正文取出来变成字符串。需要 JSON 或对象时，现在更推荐 `model.with_structured_output(Schema)`：传一个 Pydantic 模型，框架利用厂商的工具调用或 JSON 模式约束输出，直接返回解析好的对象。老式"在提示词里写格式要求、再用解析器从文本里抠 JSON"的做法仍能用，但更容易解析失败。结构化输出的原理见 [结构化输出](/ai/prompt/04-structured-output)。

### Runnable：统一接口

模型、模板、解析器、检索器、整条链，都是 Runnable。它们共享一组方法：

- `invoke(input)`：处理一个输入，返回一个输出
- `stream(input)`：边生成边返回片段
- `batch([input1, input2])`：并发处理多个输入
- 对应的异步版本 `ainvoke`、`astream`、`abatch`

接口统一之后，任何两个 Runnable 都能用 `|` 拼起来，前一个的输出就是后一个的输入。组合方式见 [LCEL](/ai/frameworks/02-lcel)。

## 代码示例

```python
from pydantic import BaseModel, Field
from langchain.chat_models import init_chat_model
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

model = init_chat_model("openai:your-model")  # 换成实际的厂商和模型名

prompt = ChatPromptTemplate.from_messages([
    ("system", "你是面试官，只用中文回答。"),
    ("human", "用一句话解释{topic}"),
])

# 最小链：模板 -> 模型 -> 取出文本
chain = prompt | model | StrOutputParser()
print(chain.invoke({"topic": "闭包"}))

# 结构化输出：直接得到 Pydantic 对象
class Question(BaseModel):
    title: str = Field(description="题目")
    difficulty: int = Field(description="难度 1~3")

qa = prompt | model.with_structured_output(Question)
print(qa.invoke({"topic": "事件循环"}).title)
```

## 面试官可能追问

::: details 为什么要用 LangChain 包一层，不直接调厂商 SDK？
好处是换模型成本低、组件可复用，流式、批量、追踪这些能力统一提供。代价是多了一层抽象，出问题时要看框架源码。简单的单次调用直接用 SDK 也完全可以，选型的权衡见 [Agent 框架选型](/ai/agent/10-frameworks)。
:::

::: details with_structured_output 和输出解析器有什么区别？
解析器是事后处理：模型自由输出文本，再从文本里解析。`with_structured_output` 在请求时就把 schema 交给模型，利用工具调用或 JSON 模式约束生成，成功率更高。只有模型不支持这些能力时，才退回到提示词加解析器。
:::

::: details stream 对一条链是怎么生效的？
链里每一步都实现了流式接口。模型吐出片段后，`StrOutputParser` 这类能逐块处理的组件会立刻把片段往下传，所以整条链也能流式输出。如果中间有一步必须等完整输入（比如要解析整段 JSON），流式就会在那一步卡住，等它处理完再继续。
:::

## 易错点

- 把聊天模型当成"输入字符串、输出字符串"：它返回的是 `AIMessage`，要取文本得用 `.content` 或接一个 `StrOutputParser`
- 提示模板里想写字面量花括号时要写成双花括号转义，否则会被当成变量
- 把 Runnable 和 Agent 混为一谈：Runnable 只是统一的调用接口，一条固定的链没有"自己决定下一步"的能力
