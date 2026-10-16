---
difficulty: 1
tags: [实践]
---

# 长提示词怎么组织？为什么推荐用 XML 标签和分隔符？

::: tip 一句话回答
长提示词里混着**指令、背景、资料、示例和用户输入**，不分开写，模型容易把资料里的话当成指令，或者分不清示例和真实输入。用 **XML 标签**（如 `<documents>`、`<instructions>`）或其他明确的分隔符把各部分包起来，边界清楚，指令里也能**按标签名引用**某一部分。实践中常把**长资料放前面、问题和指令放后面**，并要求模型**用标签包住输出**，方便程序解析。
:::

## 详细解析

### 为什么要分隔

一段没有结构的长提示词常见这些问题：

- 资料里恰好有"请总结一下"这样的句子，模型把它当成了指令
- 示例和真实输入混在一起，模型去处理示例
- 想说"根据上面的合同"，但"上面"有好几段，指代不清
- 改提示词时找不到某条规则在哪，越改越乱

分隔的作用是告诉模型"这一段是什么"，同时让人维护时一眼看出结构。

### 为什么常用 XML 标签

| 方式 | 优点 | 不足 |
| --- | --- | --- |
| XML 标签 | 有开有闭，边界明确；可以嵌套；指令里能写"`<contract>` 中的条款" | 稍显啰嗦 |
| Markdown 标题 | 人读起来舒服，适合组织指令本身 | 资料里也可能有标题，边界会混 |
| 三引号、### 等分隔线 | 简单 | 只有开始没有结束标记，嵌套困难 |

标签名没有固定标准，模型并没有"内置"某些标签，起一个能看出含义的名字，全文保持一致就行。有些模型的官方文档专门推荐用 XML 标签组织提示词。

### 推荐的组织顺序

```text
<role>你是……</role>                    角色和任务目标（也可以放在 system prompt 里）

<documents>                             长资料放前面
  <document index="1">……</document>
  <document index="2">……</document>
</documents>

<examples>……</examples>                 示例，和真实输入分开

<instructions>                          要求、约束、输出格式
  只根据 <documents> 回答……
</instructions>

<question>用户的问题</question>          问题放在最后
```

资料很长时，把问题和关键指令放在末尾，模型读完资料后紧接着看到要做什么，通常效果更好。资料较多时每份加上编号或来源，方便要求模型引用，见 [文档太长放不进上下文，怎么处理](/ai/prompt/07-long-document)。

### 让输出也带标签

要求模型把不同部分写进不同标签，比如思考过程放 `<thinking>`、最终答案放 `<answer>`，程序只取需要的部分展示给用户。需要严格结构时还是用 JSON，见 [怎么让大模型稳定地输出 JSON](/ai/prompt/04-structured-output)。

## 代码示例

```ts
// 把不可信内容放进标签前，转义尖括号，防止它提前"闭合"标签
const escapeTag = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface Doc {
  title: string
  content: string
}

function buildPrompt(docs: Doc[], question: string): string {
  const docBlock = docs
    .map((d, i) => `<document index="${i + 1}">\n<title>${escapeTag(d.title)}</title>\n<content>\n${escapeTag(d.content)}\n</content>\n</document>`)
    .join('\n')
  return [
    '<documents>',
    docBlock,
    '</documents>',
    '',
    '<instructions>',
    '只根据 <documents> 中的内容回答 <question>。',
    '先把用到的原文摘录在 <quotes> 里，再在 <answer> 里给出回答。',
    '</instructions>',
    '',
    `<question>${escapeTag(question)}</question>`,
  ].join('\n')
}

// 从输出中取出某个标签的内容
function extractTag(output: string, tag: string): string | null {
  const m = output.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? m[1].trim() : null
}
```

## 面试官可能追问

::: details 用标签把用户输入包起来，能防住提示注入吗？
能降低风险，不能根除。标签让模型更容易区分"资料"和"指令"，转义能防止输入伪造闭合标签，但模型仍可能被资料里的文字带偏。还要配合权限控制和输出检查，见 [怎么防止 Agent 失控](/ai/agent/07-guardrails)。
:::

::: details 标签嵌套多深合适？
够用就行，一般两三层。把多份同类资料放在一个外层标签里、每份单独一个子标签，就很清楚了；层级太深反而增加 token 和理解负担。
:::

::: details 系统提示里放规则，资料放用户消息里，这样分对吗？
通常是对的：稳定的角色和规则放 system prompt，每次变化的资料和问题放在用户消息里，用标签组织。这样也便于利用提示缓存，固定部分放在前面不变，见 [System Prompt 和 User Prompt 有什么区别](/ai/prompt/03-system-prompt)。
:::

## 易错点

- 用户内容直接拼进标签，不做转义，输入里的闭合标签会打乱结构
- 标签名前后不一致，指令里写 `<docs>`，实际用的是 `<documents>`
- 以为加了分隔符就能完全防住提示注入
