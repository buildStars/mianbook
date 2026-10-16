// 面试官打分评测：用 evals/scoring.json 里每道题的好、一般、错误、带注入四档回答，让真实模型反复打分，
// 看格式遵守率、档位命中率、分数稳定性、三档排序和防注入。会消耗 AI 额度，所以默认只打印计划，加 --yes 才真正调用。
// 用法：npm run eval:scoring -- --yes [--runs=3] [--concurrency=2] [--limit=8] [--model=xxx]
// 模型配置读 .env 的 NUXT_AI_BASE_URL、NUXT_AI_API_KEY、NUXT_AI_MODEL；提示词和线上用的是同一套（server/utils/interview.ts）
import fs from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { PROMPT_VERSIONS } from '../shared/utils/prompt-versions'
import { createDb, tables } from '../server/utils/db'
import { buildInterviewMessages, parseFeedback } from '../server/utils/interview'
import { EXPECTED, scoringReport, type AnswerRuns, type Level } from './lib/scoring'

const root = path.resolve(import.meta.dirname, '..')
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {
  // 没有 .env 时使用已有的环境变量
}
const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const runs = Math.max(1, Number(arg('runs', '3')))
const concurrency = Math.max(1, Number(arg('concurrency', '2')))
const limit = Number(arg('limit', '0'))

const baseUrl = (process.env.NUXT_AI_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/+$/, '')
const apiKey = process.env.NUXT_AI_API_KEY ?? ''
const model = arg('model', process.env.NUXT_AI_MODEL || 'kimi-k2-turbo-preview')
if (!apiKey) {
  console.error('没有配置 NUXT_AI_API_KEY，无法调用模型')
  process.exit(1)
}

interface Item {
  path: string
  answers: { level: Level; text: string }[]
}
let items: Item[] = JSON.parse(fs.readFileSync(path.join(root, 'evals/scoring.json'), 'utf8'))
if (limit > 0) items = items.slice(0, limit)
const total = items.reduce((n, i) => n + i.answers.length, 0) * runs

console.log(`评测 ${items.length} 道题、${total / runs} 个回答，每个打 ${runs} 次，共调用 ${model} ${total} 次（提示词 ${PROMPT_VERSIONS.interview}）`)
if (!process.argv.includes('--yes')) {
  console.log('会消耗 AI 额度。确认后加 --yes 运行，比如：npm run eval:scoring -- --yes')
  process.exit(0)
}

// 参考答案从数据库读，和线上面试官看到的一样
const url = process.env.NUXT_DATABASE_URL
if (!url) {
  console.error('没有配置 NUXT_DATABASE_URL')
  process.exit(1)
}
const db = createDb(url)
const questions = new Map<string, { title: string; contentMd: string }>()
for (const item of items) {
  const [part, category, slug] = item.path.split('/')
  const [row] = await db
    .select({ title: tables.questions.title, contentMd: tables.questions.contentMd })
    .from(tables.questions)
    .innerJoin(tables.categories, eq(tables.categories.id, tables.questions.categoryId))
    .innerJoin(tables.parts, eq(tables.parts.id, tables.categories.partId))
    .where(and(eq(tables.parts.slug, part!), eq(tables.categories.slug, category!), eq(tables.questions.slug, slug!)))
  if (!row) throw new Error(`题目不存在：${item.path}`)
  questions.set(item.path, row)
}
await (db.$client as { end: () => Promise<void> }).end()

/** 非流式调用一次，429 和 5xx 时等一会儿重试一次 */
async function score(item: Item, answer: string): Promise<{ score: number | null; ms: number }> {
  const q = questions.get(item.path)!
  const messages = buildInterviewMessages({ title: q.title.replace(/`/g, ''), reference: q.contentMd, turns: [], answer, maxRounds: 1 })
  for (let attempt = 0; ; attempt++) {
    const started = performance.now()
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: false, max_tokens: 1024 }),
      signal: AbortSignal.timeout(120_000),
    })
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }
    if (!res.ok) throw new Error(`模型接口返回 ${res.status}：${(await res.text()).slice(0, 200)}`)
    const body = await res.json()
    const text = String(body?.choices?.[0]?.message?.content ?? '')
    return { score: parseFeedback(text, true).score, ms: Math.round(performance.now() - started) }
  }
}

const tasks = items.flatMap((item) => item.answers.flatMap((a) => Array.from({ length: runs }, () => ({ item, answer: a }))))
const results = new Map<string, AnswerRuns>()
const latencies: number[] = []
let done = 0
let next = 0
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < tasks.length) {
      const { item, answer } = tasks[next++]!
      const { score: s, ms } = await score(item, answer.text)
      latencies.push(ms)
      const key = `${item.path}|${answer.level}`
      if (!results.has(key)) results.set(key, { path: item.path, level: answer.level, scores: [] })
      results.get(key)!.scores.push(s)
      process.stdout.write(`\r已完成 ${++done}/${tasks.length}`)
    }
  }),
)
console.log('\n')

const report = scoringReport([...results.values()])
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(0)}%`)
console.log(`格式遵守率 ${pct(report.formatRate)} · 档位命中率 ${pct(report.bandHit)} · 三档排序全对 ${pct(report.rankingExact)}（两两比较 ${pct(report.rankingPairwise)}）`)
console.log(`稳定性：同一回答多次打分的标准差平均 ${report.stdevMean}，最大 ${report.stdevMax}`)
console.log(`防注入：注入回答最高 ${report.injectionMax ?? '—'} 分，${pct(report.injectionPass)} 的打分不超过 ${EXPECTED.injection[1]} 分\n`)
console.log('档位       期望      平均分   命中率')
for (const [level, v] of Object.entries(report.byLevel)) {
  console.log(`${level.padEnd(10)} ${EXPECTED[level as Level].join('～').padEnd(8)} ${String(v.mean ?? '—').padStart(6)}   ${pct(v.bandHit).padStart(5)}`)
}
const sorted = [...latencies].sort((a, b) => a - b)
console.log(`\n单次打分耗时 P50 ${sorted[Math.floor(sorted.length * 0.5)]}ms，P95 ${sorted[Math.floor(sorted.length * 0.95)]}ms`)
if (report.failures.length) {
  console.log(`\n不符合预期的回答：`)
  for (const f of report.failures) console.log(`  ✗ ${f.path} [${f.level}] ${f.reason}：${f.scores.join(', ')}`)
}

// 结果存下来，改提示词后可以对比
const outDir = path.join(root, 'evals/results')
fs.mkdirSync(outDir, { recursive: true })
const file = path.join(outDir, `scoring-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.json`)
fs.writeFileSync(file, JSON.stringify({ model, promptVersion: PROMPT_VERSIONS.interview, runs, report, results: [...results.values()] }, null, 2))
console.log(`\n结果已保存到 ${path.relative(root, file)}`)
