// 检索评测：用 evals/retrieval.json 里的问题，对比只用关键词、只用向量、混合检索三种方式的 Recall@k 和 MRR。
// 用法：npm run eval:retrieval [-- --verbose]
//   切块直接用数据库里的题目现算（和服务端同一套代码），向量复用服务端已经生成好的（按内容哈希匹配），
//   所以要先启动一次服务、等后台"知识库"里的向量生成完。没有配置 NUXT_EMBED_API_KEY 时只评测关键词检索
import fs from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { createDb, tables } from '../server/utils/db'
import {
  buildRetriever,
  bufferToVector,
  chunkQuestion,
  embedInput,
  embedTexts,
  hashText,
  rankQuestions,
  retrieve,
  scoreRankings,
  type EvalScores,
  type IndexedChunk,
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
const results = new Map<string, { scores: EvalScores; rankings: number[][] }>()
console.log(`\n${'方式'.padEnd(10)}  Recall@1  Recall@3  Recall@5      MRR`)
for (const mode of modes) {
  const rankings = items.map((item, i) =>
    // 按题目评测：每道题只取最好的一块，看期望的题排第几
    rankQuestions(retrieve(retriever, item.q, mode.vector ? queryVectors[i]! : null, { ...mode.options, limit: 10, perQuestion: 1, candidates: 50 }).hits),
  )
  const scores = scoreRankings(rankings, expected)
  results.set(mode.name, { scores, rankings })
  console.log(`${mode.name.padEnd(10)} ${pct(scores.recall1)}   ${pct(scores.recall3)}   ${pct(scores.recall5)}   ${scores.mrr.toFixed(3).padStart(6)}`)
}

// 按问题类型看最后一种方式（有向量时是混合检索）的 Recall@5
const best = modes.at(-1)!
const { rankings } = results.get(best.name)!
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
    rankings[i]!.slice(0, 3).forEach((id, k) => console.log(`      ${k + 1}. ${titleById.get(id)}`))
  }
}
