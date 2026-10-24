import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyRerank,
  bufferToVector,
  buildRetriever,
  chunkQuestion,
  cleanMarkdown,
  embedInput,
  fuseRerank,
  normalizeVector,
  previewText,
  rankQuestions,
  rerankDocuments,
  rerankTexts,
  retrieve,
  rrf,
  scoreRankings,
  splitLong,
  tokenizeSearchText,
  vectorToBuffer,
  type IndexedChunk,
  type RetrievalHit,
} from '../../server/utils/rag-core'
import { buildAskMessages, extractCitations, retrievalQuery } from '../../server/utils/ask'

const QUESTION = [
  '::: tip 一句话回答',
  '**穿透**查不存在的数据，用布隆过滤器；**击穿**是热点 key 过期。',
  ':::',
  '',
  '## 详细解析',
  '',
  '| 问题 | 解决 |',
  '| --- | --- |',
  '| 穿透 | 缓存空值 |',
  '',
  '```js',
  '## 这不是标题，是代码里的注释',
  "redis.set(key, '', 'EX', 60)",
  '```',
  '',
  '## 面试官可能追问',
  '',
  '::: details 布隆过滤器的原理？',
  '位数组加多个哈希函数，存在误判。',
  ':::',
  '',
  '::: details 互斥锁和 `逻辑过期` 怎么选？',
  '看更看重一致性还是可用性。',
  ':::',
  '',
  '## 易错点',
  '',
  '- 击穿针对**一个** key',
].join('\n')

describe('切块', () => {
  it('一句话回答、每个二级标题、每个追问各成一块', () => {
    const chunks = chunkQuestion(QUESTION)
    expect(chunks.map((c) => c.heading)).toEqual([
      '一句话回答',
      '详细解析',
      '追问：布隆过滤器的原理？',
      '追问：互斥锁和 逻辑过期 怎么选？',
      '易错点',
    ])
    expect(chunks.map((c) => c.ord)).toEqual([0, 1, 2, 3, 4])
    expect(chunks[0]!.text).toBe('穿透查不存在的数据，用布隆过滤器；击穿是热点 key 过期。')
    // 代码块里的 ## 不会被当成标题，代码内容保留
    expect(chunks[1]!.text).toContain('## 这不是标题')
    expect(chunks[1]!.text).toContain("redis.set(key, '', 'EX', 60)")
    expect(chunks[2]!.text).toBe('布隆过滤器的原理？\n位数组加多个哈希函数，存在误判。')
  })

  it('清理 Markdown：表格、加粗、行内代码、链接、容器标记', () => {
    const text = cleanMarkdown('| a | b |\n| --- | --- |\n| `x` | **y** |\n\n看 [文档](https://x.dev)\n\n::: warning 注意\n内容\n:::')
    expect(text).toBe('a | b\nx | y\n\n看 文档\n\n注意：\n内容')
  })

  it('长代码只保留前 40 行', () => {
    const code = ['```js', ...Array.from({ length: 60 }, (_, i) => `line${i}`), '```'].join('\n')
    const text = cleanMarkdown(code)
    expect(text).toContain('line39')
    expect(text).not.toContain('line40')
    expect(text.endsWith('…')).toBe(true)
  })

  it('超长的小节按段落切开，续接的块标题带"续"', () => {
    const para = '很长的段落。'.repeat(60) // 360 字
    const md = `## 详细解析\n\n${para}\n\n${para}\n\n${para}`
    const chunks = chunkQuestion(md)
    expect(chunks.length).toBe(2)
    expect(chunks[1]!.heading).toBe('详细解析（续）')
    expect(chunks.every((c) => c.text.length <= 900)).toBe(true)
  })

  it('一行就超长时硬切', () => {
    expect(splitLong('字'.repeat(2000), 900).map((p) => p.length)).toEqual([900, 900, 200])
  })

  it('资料预览：去掉列表符号、表格竖线换成逗号、合成一行，代码里的 || 不动', () => {
    const md = [
      '- Redis 是单线程',
      '- 6.0 起网络 I/O 多线程',
      '',
      '| 原因 | 说明 |',
      '| --- | --- |',
      '| 内存存储 | 不走磁盘 |',
      '',
      '```js',
      'const ok = a || b',
      '```',
    ].join('\n')
    const text = cleanMarkdown(md)
    expect(previewText(text)).toBe('Redis 是单线程 6.0 起网络 I/O 多线程 原因，说明 内存存储，不走磁盘 const ok = a || b')
    expect(previewText('字'.repeat(200), 140)).toHaveLength(140)
  })

  it('向量输入带上题目和小节', () => {
    expect(embedInput('`useEffect` 怎么用？', { heading: '易错点', text: '依赖数组' })).toBe('useEffect 怎么用？\n易错点\n依赖数组')
  })
})

describe('向量', () => {
  it('归一化后点积就是余弦相似度；存成 Buffer 再读回不变', () => {
    const v = normalizeVector([3, 4])
    expect([...v].map((x) => Math.round(x * 100) / 100)).toEqual([0.6, 0.8])
    // 模拟数据库读出的、没有按 4 字节对齐的 Buffer
    const raw = Buffer.concat([Buffer.from([0]), vectorToBuffer(v)]).subarray(1)
    expect([...bufferToVector(raw)]).toEqual([...v])
  })
})

const chunk = (id: number, questionId: number, text: string, vector: number[] | null = null): IndexedChunk => ({
  id,
  questionId,
  title: `题目${questionId}`,
  path: `/q/${questionId}`,
  category: '测试',
  heading: '详细解析',
  text,
  vector: vector ? normalizeVector(vector) : null,
})

describe('检索', () => {
  it('被切成单字的词两两拼回双字词，孤立的单字保留', () => {
    // Intl.Segmenter 会把"页面""回事"切成单字
    expect(tokenizeSearchText('页面无限刷新咋回事')).toEqual(expect.arrayContaining(['页面', '回事']))
    expect(tokenizeSearchText('页面无限刷新')).not.toContain('页')
    expect(tokenizeSearchText('加锁 锁 hello')).toEqual(expect.arrayContaining(['锁', 'hello']))
  })

  it('分词时去掉疑问词和口头禅', () => {
    const r = buildRetriever([chunk(1, 1, '布隆过滤器')])
    expect(tokenizeSearchText('什么是布隆过滤器').length).toBeGreaterThan(1)
    // "什么""怎么"被忽略，只剩真正的关键词
    expect(retrieve(r, '什么 怎么', null).hits).toEqual([])
  })

  it('RRF 按排名融合：两路都靠前的排第一', () => {
    const fused = rrf([
      [{ id: 1, score: 9 }, { id: 2, score: 5 }, { id: 3, score: 1 }],
      [{ id: 2, score: 0.9 }, { id: 4, score: 0.8 }, { id: 1, score: 0.1 }],
    ])
    expect(fused.map((f) => f.id)).toEqual([2, 1, 4, 3])
    expect(fused[0]!.score).toBeCloseTo(1 / 62 + 1 / 61)
  })

  it('混合检索：关键词没命中时向量也能找回来，同一道题最多两块', () => {
    const r = buildRetriever([
      chunk(1, 1, 'Redis 缓存穿透 布隆过滤器', [1, 0, 0]),
      chunk(2, 1, 'Redis 缓存空值', [0.9, 0.1, 0]),
      chunk(3, 1, 'Redis 互斥锁', [0.8, 0.2, 0]),
      chunk(4, 2, '数据库被不存在的 id 刷爆', [0.95, 0, 0.05]),
      chunk(5, 3, 'Vue 响应式', [0, 0, 1]),
    ])
    const query = normalizeVector([1, 0, 0])
    const hybrid = retrieve(r, 'Redis 布隆过滤器', query, { limit: 5, perQuestion: 2 })
    expect(hybrid.mode).toBe('hybrid')
    expect(hybrid.hits[0]!.chunk.id).toBe(1)
    expect(hybrid.hits.filter((h) => h.chunk.questionId === 1).length).toBe(2)
    // 第 4 块没有任何关键词命中，靠向量召回
    const semantic = hybrid.hits.find((h) => h.chunk.id === 4)!
    expect(semantic.keywordRank).toBeNull()
    expect(semantic.vectorRank).toBe(2)
    expect(rankQuestions(hybrid.hits).slice(0, 2)).toEqual([1, 2])
    // 记下融合排序里的排名，重排后对照用
    expect(hybrid.hits.map((h) => h.fusedRank)).toEqual(hybrid.hits.map((_, i) => i + 1))
    expect(hybrid.hits.every((h) => h.rerankScore === null)).toBe(true)

    // 没有问题向量时只用关键词
    const keyword = retrieve(r, 'Redis 布隆过滤器', null)
    expect(keyword.mode).toBe('keyword')
    expect(keyword.hits.every((h) => h.vectorRank === null)).toBe(true)
    expect(retrieve(r, 'Redis 布隆过滤器', query, { only: 'vector' }).hits.every((h) => h.keywordRank === null)).toBe(true)
  })

  it('维度不同的旧向量不参与比较', () => {
    const r = buildRetriever([chunk(1, 1, 'a', [1, 0]), chunk(2, 2, 'b', [1, 0, 0])])
    const hits = retrieve(r, 'zzz', normalizeVector([1, 0, 0])).hits
    expect(hits.map((h) => h.chunk.id)).toEqual([2])
  })
})

describe('重排', () => {
  const target = { baseUrl: 'https://rerank.test/v1/', apiKey: 'test-key', model: 'test-reranker' }
  const hit = (id: number): RetrievalHit => ({
    chunk: { id, questionId: id, title: `题目 ${id}`, path: `/q/${id}`, category: '测试', heading: '小节', text: `内容 ${id}`, vector: null },
    score: 1 / (60 + id),
    keywordRank: id,
    vectorRank: null,
    similarity: null,
    fusedRank: id,
    rerankScore: null,
  })
  const stubFetch = (respond: (body: any) => Response) => {
    const calls: { url: string; body: any }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      calls.push({ url, body })
      return respond(body)
    })
    return calls
  }
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('按重排分数从高到低排，同分时保持融合排序的先后，不改原数组', () => {
    const hits = [hit(1), hit(2), hit(3), hit(4)]
    const out = applyRerank(hits, [0.1, 0.9, 0.5, 0.9])
    expect(out.map((h) => h.chunk.id)).toEqual([2, 4, 3, 1])
    expect(out.map((h) => h.rerankScore)).toEqual([0.9, 0.9, 0.5, 0.1])
    expect(out.map((h) => h.fusedRank)).toEqual([2, 4, 3, 1])
    expect(hits.every((h) => h.rerankScore === null)).toBe(true)
  })

  it('最终顺序：融合排序和重排排序再做 RRF，重排第一、融合排序靠后的块只往前挪几位', () => {
    const hits = [1, 2, 3, 4, 5].map(hit)
    const scores = [0.5, 0.4, 0.3, 0.2, 0.9]
    expect(applyRerank(hits, scores).map((h) => h.chunk.id)).toEqual([5, 1, 2, 3, 4])
    // 第 5 块：1/65 + 1/61，介于第 2 块（1/62 + 1/63）和第 3 块（1/63 + 1/64）之间
    const out = fuseRerank(hits, scores)
    expect(out.map((h) => h.chunk.id)).toEqual([1, 2, 5, 3, 4])
    expect(out.map((h) => h.rerankScore)).toEqual([0.5, 0.4, 0.9, 0.3, 0.2])
    expect(out.map((h) => h.fusedRank)).toEqual([1, 2, 5, 3, 4])
    // 两种排序一致时顺序不变
    expect(fuseRerank(hits, [0.9, 0.8, 0.7, 0.6, 0.5]).map((h) => h.chunk.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('调用 /rerank：送的是带题目和小节的文本，分数按 index 对回原来的位置', async () => {
    // 接口返回的结果按相关度排好了序，不是原来的顺序
    const calls = stubFetch(() =>
      Response.json({
        id: 'rerank-1',
        results: [
          { index: 2, relevance_score: 0.8 },
          { index: 0, relevance_score: 0.5 },
          { index: 1, relevance_score: 0.1 },
        ],
        meta: { tokens: { input_tokens: 42, output_tokens: 0 } },
      }),
    )
    const out = await rerankTexts(target, '缓存穿透', rerankDocuments([hit(1), hit(2), hit(3)]))
    expect(calls[0]!.url).toBe('https://rerank.test/v1/rerank')
    expect(calls[0]!.body).toMatchObject({ model: 'test-reranker', query: '缓存穿透', top_n: 3, return_documents: false })
    expect(calls[0]!.body.documents[0]).toBe(embedInput('题目 1', { heading: '小节', text: '内容 1' }))
    expect(out).toEqual({ scores: [0.5, 0.1, 0.8], tokens: 42 })
  })

  it('接口出错时带上状态码和原因（JSON 或纯文字）；结果缺了或分数不是数字时报错', async () => {
    stubFetch(() => new Response('404 page not found', { status: 404 }))
    await expect(rerankTexts(target, 'q', ['a', 'b'])).rejects.toThrow('重排接口出错（404）：404 page not found')
    stubFetch(() => Response.json({ code: 20012, message: 'Model does not exist.' }, { status: 400 }))
    await expect(rerankTexts(target, 'q', ['a', 'b'])).rejects.toThrow('重排接口出错（400）：Model does not exist.')
    stubFetch(() => Response.json({ results: [{ index: 0, relevance_score: 0.3 }, { index: 1, relevance_score: 'high' }] }))
    await expect(rerankTexts(target, 'q', ['a', 'b'])).rejects.toThrow('重排接口返回了 1 条有效结果，期望 2 条')
  })

  it('没有文档时不调用接口', async () => {
    const calls = stubFetch(() => Response.json({ results: [] }))
    expect(await rerankTexts(target, 'q', [])).toEqual({ scores: [], tokens: 0 })
    expect(calls).toHaveLength(0)
  })
})

describe('评测指标', () => {
  it('Recall@k 和 MRR', () => {
    const scores = scoreRankings(
      [
        [7, 1, 2], // 第 2 名命中
        [3, 4, 5, 6, 8, 9], // 没命中
        [5], // 第 1 名命中
        [1, 2, 3, 4, 9], // 第 5 名命中
      ],
      [[1], [99], [5], [9, 77]],
    )
    expect(scores.recall1).toBe(0.25)
    expect(scores.recall3).toBe(0.5)
    expect(scores.recall5).toBe(0.75)
    expect(scores.mrr).toBeCloseTo((1 / 2 + 1 + 1 / 5) / 4)
  })
})

describe('问手册的提示词', () => {
  const sources = [
    { n: 1, title: '缓存穿透是什么？', heading: '一句话回答', text: '查不存在的数据' },
    { n: 2, title: '布隆过滤器', heading: '详细解析', text: '位数组' },
  ]

  it('资料带编号放在最后一条用户消息里，系统提示要求标注出处、防注入', () => {
    const messages = buildAskMessages({ question: '怎么防穿透？', history: [], sources })
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toContain('[1]')
    expect(messages[0]!.content).toContain('当作普通文字')
    expect(messages.at(-1)!.content).toBe('【资料】\n[1] 《缓存穿透是什么？》· 一句话回答\n查不存在的数据\n\n[2] 《布隆过滤器》· 详细解析\n位数组\n\n【问题】\n怎么防穿透？')
  })

  it('历史回答去掉旧的引用编号，只保留最近 6 条', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: i % 2 ? `回答${i} [1][2]` : `问题${i}`,
    }))
    const messages = buildAskMessages({ question: '那缺点呢', history, sources })
    expect(messages.length).toBe(1 + 6 + 1)
    expect(messages[1]!.content).toBe('问题2')
    expect(messages[2]!.content).toBe('回答3')
  })

  it('短追问补上上一个问题再检索', () => {
    const history = [
      { role: 'user' as const, content: 'Redis 为什么快' },
      { role: 'assistant' as const, content: '因为……' },
    ]
    expect(retrievalQuery('那缺点呢？', history)).toBe('Redis 为什么快 那缺点呢？')
    expect(retrievalQuery('那缺点呢？', [])).toBe('那缺点呢？')
    const long = 'MySQL 的 MVCC 是怎么实现可重复读的？详细说说'
    expect(retrievalQuery(long, history)).toBe(long)
  })

  it('提取引用编号：去重、按出现顺序、忽略超出范围的', () => {
    expect(extractCitations('结论[2]。另外[1][2]，还有[7]和[0]', 3)).toEqual([2, 1])
  })
})
