---
difficulty: 1
tags: [实践, 场景题]
---

# 适配器模式是什么？适合什么场景？

::: tip 一句话回答
适配器模式在调用方和被调用方之间加一层**接口转换**：调用方按自己期望的接口写代码，适配器把调用翻译成被适配对象的接口，再把结果转换成调用方要的格式。它解决的是"**功能已经有了，只是接口对不上**"。常见场景有：统一多家大模型厂商 SDK 的调用和返回格式、把后端旧接口的数据结构转换成新组件需要的格式、给不同的地图 SDK 封装统一的 API。它和几种相近模式的区别在于接口：代理、装饰器和目标的接口相同，外观为一组复杂的子系统提供简化的入口，适配器则是把已有的接口转换成调用方期望的样子。
:::

## 详细解析

### 例一：统一多家大模型的调用

各家大模型 SDK 的请求参数和返回结构都有差异。以 OpenAI 和 Anthropic 的官方 SDK 为例：系统提示词一个放在 `messages` 里，一个是单独的 `system` 参数；Anthropic 要求必须传 `max_tokens`；回复内容一个在 `choices[0].message.content`，一个在 `content` 数组的文本块里；token 用量的字段名也不一样。业务代码不应该到处写 `if (provider === 'openai')`，而是先约定一个统一的接口，每家写一个适配器：

```js
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

// 统一接口：chat({ system, messages }) → { text, usage: { input, output } }
function createOpenAIAdapter({ apiKey, model }) {
  const client = new OpenAI({ apiKey })
  return {
    async chat({ system, messages }) {
      const res = await client.chat.completions.create({
        model,
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      })
      return {
        text: res.choices[0].message.content,
        usage: { input: res.usage.prompt_tokens, output: res.usage.completion_tokens },
      }
    },
  }
}

function createAnthropicAdapter({ apiKey, model, maxTokens = 4096 }) {
  const client = new Anthropic({ apiKey })
  return {
    async chat({ system, messages }) {
      const res = await client.messages.create({ model, system, max_tokens: maxTokens, messages })
      return {
        // content 是内容块数组，只取其中的文本块
        text: res.content.filter((block) => block.type === 'text').map((block) => block.text).join(''),
        usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
      }
    },
  }
}

// 业务代码只依赖统一接口；厂商、模型名和密钥都来自服务端的配置
const llm = process.env.LLM_PROVIDER === 'anthropic'
  ? createAnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.LLM_MODEL })
  : createOpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY, model: process.env.LLM_MODEL })

const { text } = await llm.chat({
  system: '你是一名技术面试官',
  messages: [{ role: 'user', content: '请出一道 Node.js 的面试题' }],
})
```

这段代码运行在服务端，API Key 不能放到前端，见 [API Key 怎么安全管理](/engineering/security/07-api-key)。各家 SDK 的字段以官方文档为准。很多厂商还提供了兼容 OpenAI 格式的接口，相当于厂商替你做了适配；接入的厂商多了，可以把这一层做成独立的服务，见 [设计一个大模型网关](/engineering/system-design/05-llm-gateway)。

### 例二：兼容旧接口的数据结构

后端旧接口返回下划线命名的字段和秒级时间戳，新组件需要驼峰命名和 Date 对象。在请求层加一个适配函数，组件只认新格式；以后后端接口升级，只改这一个函数：

```js
// 旧接口返回：{ user_name: 'Tom', avatar_url: null, reg_time: 1700000000 }
function adaptUser(raw) {
  return {
    name: raw.user_name,
    avatar: raw.avatar_url ?? '/default-avatar.png', // 补上缺失的值
    registeredAt: new Date(raw.reg_time * 1000),      // 秒级时间戳转成 Date
  }
}

export async function fetchUser(id) {
  const res = await fetch(`/api/user/${id}`)
  return adaptUser(await res.json())
}
```

### 例三：封装不同的地图 SDK

不同地图 SDK 创建地图、添加标记、监听事件的 API 各不相同，使用的坐标系也可能不同（如 WGS-84、GCJ-02、BD-09）。项目里先定义自己的接口，比如 `createMap(el, options)` 返回 `{ setCenter, addMarker, destroy }`，每个 SDK 写一个适配器，坐标转换也放在适配器里。业务代码不直接调用任何一家的 API，更换地图供应商时新增一个适配器即可。

### 和外观模式、代理模式的区别

| | 适配器 | 外观（Facade） | 代理 |
| --- | --- | --- | --- |
| 解决什么问题 | 接口不兼容 | 子系统太复杂，用起来麻烦 | 需要控制对目标的访问 |
| 对接口的影响 | 转换成调用方期望的接口 | 提供一个更简单的新接口 | 和目标保持完全相同 |
| 包装的对象 | 通常是一个已有的对象 | 一组子系统 | 一个目标对象 |
| 例子 | 统一多家 SDK、转换旧数据结构 | 用一个 `upload(file)` 封装切片、计算 hash、并发上传和重试 | 缓存代理、图片预加载 |

外观的例子可以参考 [大文件上传](/basics/network/18-large-file-upload) 的流程，调用方只调一个函数，不用了解背后的多个步骤；代理的例子见 [代理模式](/basics/design-pattern/05-proxy)。

## 面试官可能追问

::: details 适配器应该放在哪一层？
放在系统的边界上，比如前端的接口请求层、服务端调用第三方服务的那一层。外部的数据结构一进入系统就被转换成内部格式，组件和业务逻辑只认内部格式，外部发生变化时只改边界这一层。领域驱动设计里的"防腐层"就是这个思路。
:::

::: details 适配器模式有什么缺点？
多了一层转换，要维护的代码也多了。更隐蔽的问题是，统一接口容易变成各家能力的"最小公共子集"：某一家特有的参数在统一接口里表达不了。可以给统一接口留一个扩展字段，原样透传给对应的厂商。如果适配器越写越多、越写越复杂，说明应该推动上游统一接口了。
:::

::: details axios 的 adapter 是适配器模式吗？
是。axios 对外提供统一的请求配置和响应格式，内部按运行环境选择不同的适配器发送请求：浏览器中用 XMLHttpRequest，Node.js 中用 http 模块，较新的版本还提供了基于 fetch 的适配器，也可以通过 `adapter` 配置传入自定义的实现。Node.js 的 `util.promisify` 也是一个适配器，把错误优先回调风格的函数转换成返回 Promise 的函数。
:::

## 易错点

- 适配器只负责转换接口，不要把业务逻辑塞进去
- 和外观模式混淆：适配器是"改接口"，外观是"简化接口"
- 转换数据时要处理好字段缺失和类型差异（比如时间戳是秒还是毫秒），否则问题会被藏在适配层里
