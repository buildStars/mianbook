// 检索评测：用 evals/retrieval.json 里的问题，对比只用关键词、只用向量、混合检索、混合检索 + 重排的 Recall@k 和 MRR。
// 用法：npm run eval:retrieval [-- --verbose] [-- --candidates=30]
//   切块直接用数据库里的题目现算（和服务端同一套代码），向量复用服务端已经生成好的（按内容哈希匹配），
//   所以要先启动一次服务、等后台"知识库"里的向量生成完。没有配置 NUXT_EMBED_API_KEY 时只评测关键词检索。
//   重排每个问题调用一次 /rerank，--candidates 指定交给重排模型的块数（默认和线上一样，NUXT_RERANK_CANDIDATES 或 30）。
//   同一份重排分数算两种顺序："只按重排分数"作对照，"混合 + 重排"是线上的做法（融合排序和重排分数的排序再做一次 RRF）
import fs from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { createDb, tables } from '../server/utils/db'
import {
  applyRerank,
  buildRetriever,
  bufferToVector,
  chunkQuestion,
  embedInput,
  embedTexts,
  fuseRerank,
  hashText,
  rankQuestions,
  rerankDocuments,
  RerankError,
  rerankTexts,
  retrieve,
  scoreRankings,
  type EvalScores,
  type IndexedChunk,
  type RerankTarget,
  type RetrieveOptions,
} from '../server/utils/rag-core'

const root = path.resolve(import.meta.dirname, '..')
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {
  // 没有 .env 时使用已有的环境变量
}
const verbose = process.argv.includes('--verbose')

const url = process.env.NUXT_DATABASE_URL
if (!url) {
  console.error('没有配置 NUXT_DATABASE_URL')
  process.exit(1)
}
// 默认值和 nuxt.config.ts 里的 runtimeConfig.embed 一致
const embed = process.env.NUXT_EMBED_API_KEY
  ? {
      baseUrl: process.env.NUXT_EMBED_BASE_URL || 'https://api.siliconflow.cn/v1',
      apiKey: process.env.NUXT_EMBED_API_KEY,
      model: process.env.NUXT_EMBED_MODEL || 'BAAI/bge-m3',
      batchSize: Number(process.env.NUXT_EMBED_BATCH_SIZE) || 16,
    }
  : null
// 默认值和 runtimeConfig.rerank 一致：地址和 Key 没单独填时沿用向量模型的，NUXT_RERANK_MODEL 设为空时不重排
const rerankModel = process.env.NUXT_RERANK_MODEL ?? 'BAAI/bge-reranker-v2-m3'
const rerankKey = process.env.NUXT_RERANK_API_KEY || embed?.apiKey
const candidatesArg = process.argv.find((a) => a.startsWith('--candidates='))?.slice('--candidates='.length)
const rerank: (RerankTarget & { candidates: number }) | null =
  rerankModel && rerankKey
    ? {
        baseUrl: process.env.NUXT_RERANK_BASE_URL || embed?.baseUrl || 'https://api.siliconflow.cn/v1',
        apiKey: rerankKey,
        model: rerankModel,
        candidates: Math.max(2, Number(candidatesArg ?? process.env.NUXT_RERANK_CANDIDATES) || 30),
      }
    : null

interface EvalItem {
  q: string
  expect: string[]
  type: string
}
const items: EvalItem[] = JSON.parse(fs.readFileSync(path.join(root, 'evals/retrieval.json'), 'utf8'))

const db = createDb(url)
const rows = await db
  .select({
    id: tables.questions.id,
    slug: tables.questions.slug,
    title: tables.questions.title,
    contentMd: tables.questions.contentMd,
    category: tables.categories.title,
    categorySlug: tables.categories.slug,
    partSlug: tables.parts.slug,
  })
  .from(tables.questions)
  .innerJoin(tables.categories, eq(tables.categories.id, tables.questions.categoryId))
  .innerJoin(tables.parts, eq(tables.parts.id, tables.categories.partId))
  .where(eq(tables.questions.status, 'published'))

// 服务端已经生成的向量，按内容哈希复用
const stored = new Map<string, Float32Array>()
if (embed) {
  const vectors = await db
    .select({ hash: tables.questionChunks.hash, embedding: tables.questionChunks.embedding })
    .from(tables.questionChunks)
    .where(and(eq(tables.questionChunks.embedModel, embed.model)))
  for (const v of vectors) if (v.embedding) stored.set(v.hash, bufferToVector(v.embedding))
}

const idByPath = new Map<string, number>()
const titleById = new Map<number, string>()
const chunks: IndexedChunk[] = []
let missingVectors = 0
for (const r of rows) {
  const p = `${r.partSlug}/${r.categorySlug}/${r.slug}`
  idByPath.set(p, r.id)
  titleById.set(r.id, r.title)
  for (const d of chunkQuestion(r.contentMd)) {
    const vector = stored.get(hashText(embedInput(r.title, d))) ?? null
    if (embed && !vector) missingVectors++
    chunks.push({ id: chunks.length + 1, questionId: r.id, title: r.title, path: `/${p}`, category: r.category, heading: d.heading, text: d.text, vector })
  }
}
await (db.$client as { end: () => Promise<void> }).end()

const expected = items.map((item) =>
  item.expect.map((p) => {
    const id = idByPath.get(p)
    if (!id) throw new Error(`评测集里的题目不存在：${p}`)
    return id
  }),
)

const retriever = buildRetriever(chunks)
console.log(`题目 ${rows.length} 道，分块 ${chunks.length} 个，评测问题 ${items.length} 个`)
if (embed) console.log(`向量模型 ${embed.model}，有向量的块 ${retriever.vectorCount} 个${missingVectors ? `（${missingVectors} 个还没生成，先启动服务等同步完）` : ''}`)
else console.log('没有配置 NUXT_EMBED_API_KEY，只评测关键词检索')

let queryVectors: Float32Array[] = []
if (embed && retriever.vectorCount) {
  const started = performance.now()
  queryVectors = (await embedTexts(embed, items.map((i) => i.q))).vectors
  console.log(`生成 ${items.length} 个问题向量用时 ${Math.round(performance.now() - started)}ms`)
}

const modes: { name: string; options: RetrieveOptions; vector: boolean }[] = [
  { name: '关键词', options: { only: 'keyword' }, vector: false },
  ...(queryVectors.length
    ? [
        { name: '向量', options: { only: 'vector' as const }, vector: true },
        { name: '混合（RRF）', options: {}, vector: true },
      ]
    : []),
]

const pct = (n: number) => `${(n * 100).toFixed(1)}%`.padStart(7)
const results: { name: string; scores: EvalScores; rankings: number[][] }[] = []
for (const mode of modes) {
  const rankings = items.map((item, i) =>
    // 按题目评测：每道题只取最好的一块，看期望的题排第几。每路取几名参与融合用线上的默认值，和重排的候选一致
    rankQuestions(retrieve(retriever, item.q, mode.vector ? queryVectors[i]! : null, { ...mode.options, limit: 10, perQuestion: 1 }).hits),
  )
  results.push({ name: mode.name, scores: scoreRankings(rankings, expected), rankings })
}

// 重排：和线上一样，取混合检索的前 N 块（每道题最多 2 块）交给重排模型，重新排序后按题目去重。
// pools[i] 是第 i 个问题的候选里有哪些题（按融合排序），期望的题不在候选里时重排也找不回来
const pools: number[][] = []
let rerankTimes: number[] = []
let rerankTokens = 0
if (rerank && queryVectors.length) {
  console.log(`重排模型 ${rerank.model}，每个问题重排混合检索的前 ${rerank.candidates} 块…`)
  const onlyRerank: number[][] = []
  const fused: number[][] = []
  try {
    for (const [i, item] of items.entries()) {
      const pool = retrieve(retriever, item.q, queryVectors[i]!, { limit: rerank.candidates, perQuestion: 2 }).hits
      let out: Awaited<ReturnType<typeof rerankTexts>> | null = null
      for (let attempt = 1; !out; attempt++) {
        const started = performance.now()
        try {
          out = await rerankTexts(rerank, item.q, rerankDocuments(pool))
          rerankTimes.push(performance.now() - started)
        } catch (error) {
          // 免费额度有每分钟的请求数和 token 数限制，被限流时等一会儿再试（等待时间不算进耗时）
          if (!(error instanceof RerankError && error.status === 429) || attempt >= 5) throw error
          console.log(`  被限流，${attempt * 10} 秒后重试…`)
          await new Promise((resolve) => setTimeout(resolve, attempt * 10_000))
        }
      }
      rerankTokens += out.tokens
      pools.push(rankQuestions(pool))
      onlyRerank.push(rankQuestions(applyRerank(pool, out.scores)))
      fused.push(rankQuestions(fuseRerank(pool, out.scores)))
    }
    results.push({ name: '只按重排分数', scores: scoreRankings(onlyRerank, expected), rankings: onlyRerank })
    results.push({ name: '混合 + 重排', scores: scoreRankings(fused, expected), rankings: fused })
  } catch (error) {
    console.error(`重排接口出错，不评测重排：${error instanceof Error ? error.message : String(error)}`)
    pools.length = 0
    rerankTimes = []
  }
}

console.log(`\n${'方式'.padEnd(10)}  Recall@1  Recall@3  Recall@5      MRR`)
for (const { name, scores } of results) {
  console.log(`${name.padEnd(10)} ${pct(scores.recall1)}   ${pct(scores.recall3)}   ${pct(scores.recall5)}   ${scores.mrr.toFixed(3).padStart(6)}`)
}

if (pools.length) {
  const covered = pools.filter((p, i) => p.some((id) => expected[i]!.includes(id))).length
  const avgQuestions = pools.reduce((s, p) => s + p.length, 0) / pools.length
  const sorted = [...rerankTimes].sort((a, b) => a - b)
  const at = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!)
  console.log(
    `\n重排的候选：每个问题 ${rerank!.candidates} 块（平均 ${avgQuestions.toFixed(1)} 道题），包含期望题目的 ${covered}/${items.length} 个（${pct(covered / items.length).trim()}），这是重排能达到的上限`,
  )
  console.log(`重排耗时 P50 ${at(0.5)}ms、P95 ${at(0.95)}ms，共 ${rerankTokens} 个 token`)

  // 和混合检索逐个比：期望的题排名变好、变差、不变的各有几个（前 10 名以外记作第 11）
  const hybrid = results.find((r) => r.name === '混合（RRF）')!
  const reranked = results.at(-1)!
  const firstRank = (ranked: number[], i: number) => {
    const k = ranked.slice(0, 10).findIndex((id) => expected[i]!.includes(id))
    return k < 0 ? 11 : k + 1
  }
  const label = (r: number) => (r > 10 ? '10 名外' : `第 ${r}`)
  const changes = items.map((item, i) => ({ item, before: firstRank(hybrid.rankings[i]!, i), after: firstRank(reranked.rankings[i]!, i) }))
  const better = changes.filter((c) => c.after < c.before)
  const worse = changes.filter((c) => c.after > c.before)
  console.log(`${reranked.name}和混合检索比：期望题目排名变好 ${better.length} 个、变差 ${worse.length} 个、不变 ${items.length - better.length - worse.length} 个`)
  if (verbose) {
    for (const c of better) console.log(`  ↑ [${c.item.type}] ${c.item.q}（${label(c.before)} → ${label(c.after)}）`)
    for (const c of worse) console.log(`  ↓ [${c.item.type}] ${c.item.q}（${label(c.before)} → ${label(c.after)}）`)
  }
}

// 按问题类型看最后一种方式（有向量时是混合检索或重排）的 Recall@5
const best = results.at(-1)!
const { rankings } = best
const types = [...new Set(items.map((i) => i.type))]
console.log(`\n按问题类型（${best.name}，Recall@5）`)
for (const type of types) {
  const idx = items.map((it, i) => (it.type === type ? i : -1)).filter((i) => i >= 0)
  const s = scoreRankings(
    idx.map((i) => rankings[i]!),
    idx.map((i) => expected[i]!),
  )
  console.log(`  ${type.padEnd(12)} ${pct(s.recall5)}  （${idx.length} 个）`)
}

// 没找回来的问题：看看排在前面的是什么，用来改切块、分词或者评测集本身
const misses = items.map((item, i) => ({ item, i })).filter(({ i }) => !rankings[i]!.slice(0, 5).some((id) => expected[i]!.includes(id)))
console.log(`\n前 5 名没找到期望题目的问题：${misses.length} 个${misses.length && !verbose ? '（加 --verbose 看排在前面的题）' : ''}`)
for (const { item, i } of misses) {
  console.log(`  ✗ [${item.type}] ${item.q}`)
  if (verbose) {
    console.log(`      期望：${item.expect.map((p) => titleById.get(idByPath.get(p)!)).join(' / ')}`)
    if (pools.length) {
      const k = pools[i]!.findIndex((id) => expected[i]!.includes(id))
      console.log(`      重排前：${k < 0 ? `不在前 ${rerank!.candidates} 块候选里` : `候选里的第 ${k + 1} 道题`}`)
    }
    rankings[i]!.slice(0, 3).forEach((id, k) => console.log(`      ${k + 1}. ${titleById.get(id)}`))
  }
}
