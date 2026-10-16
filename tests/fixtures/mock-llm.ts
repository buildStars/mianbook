/**
 * 测试用的模拟大模型：实现 OpenAI 兼容的 /chat/completions（流式和非流式）和 /models。
 * 约定：
 * - Authorization 必须是 Bearer mock-key，否则返回 401
 * - 回答里写 [score=N] 时返回 N 分，否则 6 分；写 [upstream-error] 时返回 500
 * - 系统提示里有"面试总结"时返回总结，有"项目深挖题"且非流式时返回出题 JSON
 * - 系统提示里有"写题目解析"时返回一篇用代码块包起来的题目正文（测试浏览器端的整理），有"规划选题"时返回选题列表
 * - 流式输出故意切成小块，并把一条 data 拆在两次写入里，测试服务端的拼接
 * - 系统提示是问手册的助手时返回带引用编号的回答；/embeddings 返回按字面哈希的模拟向量
 * - /rerank 默认保持文档原来的顺序（其他测试的检索结果不受重排影响）；用 /__rerank-boost 指定问题和文字后，
 *   这个问题里包含这段文字的文档排到最前面
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

/**
 * 模拟 Agent 面试官，按最后一条消息决定下一步：
 * - 面试目标 → 查学习记录 + 搜题；搜到题 → 出第一题；出题成功 → 用文字问出来，停下等回答
 * - 回答 → 查参考答案 → 打分（回答里写 [score=N] 就打 N 分，默认 6 分）→ 写 [followup] 时追问，否则出下一题，问满题量就结束
 * - 回答里写 [bad-assess] 时故意给另一道题打分，测试服务端的校验；跳过 → 出下一题；要求结束 → 写总结
 */
export function agentReply(messages: any[]): { text?: string; calls?: { name: string; args: any }[] } {
  const last = messages.at(-1)
  const parse = (s: string) => {
    try {
      return JSON.parse(s)
    } catch {
      return {}
    }
  }
  const callsOf = (name: string) =>
    messages.flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []) : [])).filter((c: any) => c.function.name === name)
  const resultOf = (call: any) => parse(messages.find((m) => m.role === 'tool' && m.tool_call_id === call.id)?.content ?? '{}')
  const asked = callsOf('ask_question').filter((c: any) => resultOf(c).ok)
  const currentQid = () => JSON.parse(asked.at(-1)?.function.arguments ?? '{}').question_id
  const maxQuestions = Number(messages.find((m) => m.role === 'user')?.content.match(/【题量】(\d+)/)?.[1] ?? 3)
  const mainsAsked = asked.filter((c: any) => !JSON.parse(c.function.arguments).follow_up)

  const nextQuestion = () => {
    if (mainsAsked.length >= maxQuestions) {
      return { calls: [{ name: 'finish_interview', args: { summary: '整体基础不错，原理还要加强。', next_steps: ['复习缓存一致性', '练习讲清方案取舍'] } }] }
    }
    const used = new Set(mainsAsked.map((c: any) => JSON.parse(c.function.arguments).question_id))
    const found = callsOf('search_questions').flatMap((c: any) => resultOf(c).questions ?? [])
    const next = found.find((q: any) => !used.has(q.id))
    return next ? { calls: [{ name: 'ask_question', args: { question_id: next.id } }] } : { text: '题库里没有更多合适的题了。' }
  }

  if (last.role === 'user') {
    const c: string = last.content
    if (c.includes('要求现在结束')) return { calls: [{ name: 'finish_interview', args: { summary: '只答了一部分，基础还可以。', next_steps: ['把没答完的题补上'] } }] }
    if (c.includes('跳过')) return nextQuestion()
    if (c.includes('[bad-assess]')) return { calls: [{ name: 'record_assessment', args: { question_id: currentQid() + 100000, score: 9, strengths: [], gaps: [] } }] }
    if (c.startsWith('<answer>')) return { calls: [{ name: 'get_question_reference', args: { question_id: currentQid() } }] }
    return {
      text: '好的，我先看看你的学习记录，再挑几道题。',
      calls: [
        { name: 'get_learning_profile', args: {} },
        { name: 'search_questions', args: { query: '缓存穿透 击穿 雪崩', limit: 5 } },
      ],
    }
  }

  // 上一步工具调用的结果
  const step = messages.findLast((m) => m.role === 'assistant')
  const names: string[] = (step?.tool_calls ?? []).map((c: any) => c.function.name)
  const results = (step?.tool_calls ?? []).map(resultOf)
  if (results.some((r: any) => r.error)) return { text: `工具出错了：${results.find((r: any) => r.error).error}` }
  if (names.includes('finish_interview')) return { text: '面试结束，祝你面试顺利！' }
  if (names.includes('ask_question')) {
    const r = results[names.indexOf('ask_question')]
    return { text: r.followUp ? `追问：${r.followUp}` : `第 ${r.index} 题：${r.title}` }
  }
  if (names.includes('get_question_reference')) {
    const answer = messages.findLast((m) => m.role === 'user')?.content ?? ''
    const score = Number(answer.match(/\[score=(\d+)\]/)?.[1] ?? 6)
    return { calls: [{ name: 'record_assessment', args: { question_id: currentQid(), score, strengths: ['讲到了主要流程'], gaps: ['没讲清取舍'] } }] }
  }
  if (names.includes('record_assessment')) {
    const answer = messages.findLast((m) => m.role === 'user')?.content ?? ''
    if (answer.includes('[followup]')) {
      return { text: '答对了一部分。', calls: [{ name: 'ask_question', args: { question_id: currentQid(), follow_up: '如果数据量再大十倍，你会怎么改？' } }] }
    }
    const next = nextQuestion()
    return { text: '点评：主干正确，取舍讲得不够。', ...next }
  }
  return nextQuestion()
}

export async function startMockLlm(): Promise<MockLlm> {
  let lastBody: any = null
  /** /embeddings 收到的文本总数，测试增量同步时只给变了的块生成向量 */
  let embedded = 0
  /** 设为 true 时 /embeddings 返回 500，测试向量接口故障时退化为关键词检索 */
  let embedDown = false
  /** /rerank 收到的请求数（包括故意返回 500 的）和最近一次请求的概要 */
  let reranks = 0
  let lastRerank: { query: string; model: string; documents: number; topN: number } | null = null
  let rerankDown = false
  let rerankBoost: { query: string; text: string } | null = null
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
    if (req.url === '/__reranks') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ calls: reranks, last: lastRerank }))
      return
    }
    if (req.url?.startsWith('/__rerank-down')) {
      rerankDown = req.url.endsWith('=1')
      res.writeHead(204)
      res.end()
      return
    }
    if (req.url?.startsWith('/__rerank-boost')) {
      // 不带参数时取消
      const params = new URL(req.url, 'http://mock').searchParams
      const text = params.get('text')
      rerankBoost = text ? { query: params.get('query') ?? '', text } : null
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
    if (req.url === '/v1/rerank' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      const documents: string[] = body.documents
      reranks++
      lastRerank = { query: body.query, model: body.model, documents: documents.length, topN: body.top_n }
      if (rerankDown) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ code: 50505, message: 'rerank service down' }))
        return
      }
      const boost = rerankBoost && rerankBoost.query === body.query ? rerankBoost.text : null
      // 分数随原来的位置递减（保持顺序）；被指定的文档整体高出一截
      const results = documents
        .map((text, index) => ({ index, relevance_score: (boost && text.includes(boost) ? 1 : 0.9) - index / (documents.length * 10) }))
        .sort((a, b) => b.relevance_score - a.relevance_score)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'mock-rerank', results, meta: { tokens: { input_tokens: documents.join('').length } } }))
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
    // Agent 面试：按对话状态决定调用哪个工具
    if (Array.isArray(body.tools) && body.tools.length) {
      const reply = agentReply(body.messages)
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const write = (delta: unknown, extra: Record<string, unknown> = {}) =>
        res.write(`data: ${JSON.stringify({ choices: [{ delta, ...extra }] })}\n\n`)
      for (const piece of reply.text?.match(/[\s\S]{1,8}/g) ?? []) write({ content: piece })
      ;(reply.calls ?? []).forEach((call, index) => {
        // 参数故意拆成两块，测试服务端按 index 拼接
        const args = JSON.stringify(call.args)
        const mid = Math.floor(args.length / 2)
        write({ tool_calls: [{ index, id: `call_${Math.random().toString(36).slice(2, 10)}`, type: 'function', function: { name: call.name, arguments: '' } }] })
        write({ tool_calls: [{ index, function: { arguments: args.slice(0, mid) } }] })
        write({ tool_calls: [{ index, function: { arguments: args.slice(mid) } }] })
      })
      write({}, { finish_reason: reply.calls?.length ? 'tool_calls' : 'stop' })
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 300, completion_tokens: 50 } })}\n\n`)
      res.end('data: [DONE]\n\n')
      return
    }
    if (body.stream === false) {
      const content = system.includes('项目深挖题')
        ? `好的：\n\`\`\`json\n${JSON.stringify(RESUME)}\n\`\`\``
        : system.includes('规划选题')
          ? TOPICS
          : system.includes('得分：X/10')
            ? feedback(user) // 打分评测脚本用非流式调用面试官
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
