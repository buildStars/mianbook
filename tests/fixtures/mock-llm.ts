/**
 * 测试用的模拟大模型：实现 OpenAI 兼容的 /chat/completions（流式和非流式）和 /models。
 * 约定：
 * - Authorization 必须是 Bearer mock-key，否则返回 401
 * - 回答里写 [score=N] 时返回 N 分，否则 6 分；写 [upstream-error] 时返回 500
 * - 系统提示里有"面试总结"时返回总结，有"项目深挖题"且非流式时返回出题 JSON
 * - 系统提示里有"写题目解析"时返回一篇用代码块包起来的题目正文（测试浏览器端的整理），有"规划选题"时返回选题列表
 * - 流式输出故意切成小块，并把一条 data 拆在两次写入里，测试服务端的拼接
 * - 系统提示是问手册的助手时返回带引用编号的回答；/embeddings 返回按字面哈希的模拟向量
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export const MOCK_KEY = 'mock-key'

export interface MockLlm {
  url: string
  /** 最近一次 /chat/completions 请求体 */
  last: () => any
  close: () => Promise<void>
}

function feedback(user: string): string {
  // 只看本轮回答：提示词里的"之前的问答"也可能带着 [score=N]
  const current = user.split('【本轮回答】').at(-1) ?? user
  const score = Number(current.match(/\[score=(\d+)\]/)?.[1] ?? 6)
  const lastRound = user.includes('这是最后一轮')
  return [
    `得分：${score}/10`,
    '### 答对的点',
    '- 讲到了主要流程',
    '### 遗漏或不准确',
    '- 没有讲清楚取舍',
    '### 改进建议',
    '先讲结论，再讲原理。',
    '### 追问',
    lastRound ? '无' : '如果数据量再大十倍，你会怎么改？',
  ].join('\n')
}

const REPORT = '### 总体评价\n基础尚可，原理不够深入。\n### 做得好的地方\n- 第 1 题思路清楚\n### 主要问题\n- 取舍讲得不清楚\n### 复习建议\n- 复习相关原理'

/** 后台 AI 写题：故意用代码块包起来并带一级标题，和真实模型偶尔的输出一样 */
const AUTHORED = [
  '```markdown',
  '# 模拟的题目',
  '',
  '::: tip 一句话回答',
  '这是 **AI 写的** 一句话回答。',
  ':::',
  '',
  '## 详细解析',
  '',
  '### 原理',
  '',
  '正文内容。',
  '',
  '## 面试官可能追问',
  '',
  '::: details 追问一？',
  '答案一。',
  ':::',
  '',
  '## 易错点',
  '',
  '- 易错点一',
  '```',
].join('\n')

const TOPICS = [
  '2|`Promise.all` 和 `Promise.allSettled` 有什么区别？|高频的对比题',
  '1|说说浏览器的事件循环（Event Loop）|和已有题目重复，应该被过滤',
  '这一行格式不对',
  '3|如何设计一个前端监控 SDK？|综合考察工程能力',
].join('\n')

const RESUME = {
  questions: [
    { title: '介绍一下你负责的直播项目和整体架构', points: ['业务背景', '个人职责', '整体架构'] },
    { title: '弹幕高峰时怎么削峰限流？为什么这样选型？', points: ['峰值和瓶颈', '限流位置和算法', '选型取舍'] },
    { title: '首屏优化具体做了什么？怎么量化效果？', points: ['定位手段', '优化项', '指标'] },
    { title: '如果重做这个项目，你会改哪里？', points: ['反思是否具体'] },
  ],
  categories: ['basics/redis', 'basics/vue', 'not/exist'],
}

/** 问手册的回答：带一个有效引用和一个超出范围的引用（[99]），测试服务端过滤 */
const ASK = '先说结论：用布隆过滤器或缓存空值[1]。\n\n- 热点 key 用互斥锁重建缓存[2]\n- 这条引用不存在[99]'

/**
 * 模拟向量：把文本里的中文双字、英文单词哈希到 256 维再归一化。
 * 字面上越像的文本越相似，足够测试"向量检索能找回关键词没命中的内容"之外的流程
 */
export function mockEmbedding(text: string, dims = 256): number[] {
  const v = new Array(dims).fill(0)
  const lower = text.toLowerCase()
  const grams = [...(lower.match(/[a-z0-9]+/g) ?? [])]
  const han = lower.replace(/[^一-鿿]/g, '')
  for (let i = 0; i < han.length - 1; i++) grams.push(han.slice(i, i + 2))
  for (const g of grams) {
    let h = 2166136261
    for (const ch of g) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
    v[(h >>> 0) % dims] += 1
  }
  const norm = Math.hypot(...v) || 1
  return v.map((x) => x / norm)
}

export async function startMockLlm(): Promise<MockLlm> {
  let lastBody: any = null
  /** /embeddings 收到的文本总数，测试增量同步时只给变了的块生成向量 */
  let embedded = 0
  /** 设为 true 时 /embeddings 返回 500，测试向量接口故障时退化为关键词检索 */
  let embedDown = false
  const server = http.createServer(async (req, res) => {
    // 测试代码跑在别的进程里，通过这个地址查看服务端最近发给模型的内容
    if (req.url === '/__last') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(lastBody))
      return
    }
    if (req.url === '/__embeds') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ embedded }))
      return
    }
    if (req.url?.startsWith('/__embed-down')) {
      embedDown = req.url.endsWith('=1')
      res.writeHead(204)
      res.end()
      return
    }
    if (req.headers.authorization !== `Bearer ${MOCK_KEY}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid Authentication' } }))
      return
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
      return
    }
    if (req.url === '/v1/embeddings' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      const input: string[] = Array.isArray(body.input) ? body.input : [body.input]
      if (embedDown) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'embedding service down' } }))
        return
      }
      embedded += input.length
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          // 故意打乱顺序，服务端要按 index 排回去
          data: input.map((text, index) => ({ index, embedding: mockEmbedding(text) })).reverse(),
          usage: { prompt_tokens: input.length * 10, total_tokens: input.length * 10 },
        }),
      )
      return
    }
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404)
      res.end()
      return
    }

    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    lastBody = body
    const system: string = body.messages[0].content
    const user: string = body.messages.at(-1).content

    if (user.includes('[upstream-error]')) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'boom' } }))
      return
    }
    if (body.stream === false) {
      const content = system.includes('项目深挖题')
        ? `好的：\n\`\`\`json\n${JSON.stringify(RESUME)}\n\`\`\``
        : system.includes('规划选题')
          ? TOPICS
          : '好'
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }))
      return
    }

    const text = system.includes('面试总结')
      ? REPORT
      : system.includes('写题目解析')
        ? AUTHORED
        : system.includes('全栈面试手册」的问答助手')
          ? ASK
          : feedback(user)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    for (const piece of text.match(/[\s\S]{1,12}/g) ?? []) {
      if (res.destroyed) return
      const line = `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`
      const mid = Math.floor(line.length / 2)
      res.write(line.slice(0, mid))
      res.write(line.slice(mid))
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 500, completion_tokens: 100 } })}\n\n`)
    res.end('data: [DONE]\n\n')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/v1`,
    last: () => lastBody,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
