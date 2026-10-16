// 选题雷达：从 GitHub 上公开的中文面试题仓库收集题目标题，统计哪些题被多个来源问到，再和题库比对，
// 列出"常被问到、题库里还没有"的题，帮你决定下一批写什么。
// 用法：npm run radar
// - 只用 GitHub 官方 API，只收集题目标题，不抓答案、不存作者；来源列表在 scripts/radar-sources.json
// - 匿名访问每小时 60 次请求，抓过的内容缓存 7 天（.data/radar-cache/），限额用完了过一小时再跑会接着抓；
//   想快一点可以在 .env 里填 GITHUB_TOKEN（只需要公开仓库的只读权限）
// - 报告写到 reports/topic-radar.md 和 reports/topic-radar.json
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { chunkQuestion } from '../server/utils/rag-core'
import {
  cleanTitle,
  clusterItems,
  containment,
  extractQuestions,
  grams,
  guessCategory,
  isNoise,
  looksLikeQuestion,
  similarity,
  strongGrams,
  type RadarCluster,
  type RadarItem,
} from './lib/radar'

const root = path.resolve(import.meta.dirname, '..')
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {
  // 没有 .env 时使用已有的环境变量
}
const token = process.env.GITHUB_TOKEN
const CACHE_DIR = path.join(root, '.data/radar-cache')
const CACHE_TTL = 7 * 86_400_000

interface Source {
  id: string
  name: string
  repo: string
  type: 'issues' | 'markdown'
  maxPages?: number
  paths?: string[]
  fileFilter?: string
  /** 猜不出分类时用的默认分类（来源本身方向明确时才填） */
  defaultCategory?: string
}

class RateLimited extends Error {}

let remaining: number | null = null
let requests = 0

/** 调 GitHub API，结果缓存在本地；限额用完时抛出 RateLimited */
async function gh(apiPath: string, raw = false): Promise<{ status: number; body: any }> {
  const url = `https://api.github.com${apiPath}`
  const file = path.join(CACHE_DIR, `${crypto.createHash('sha1').update(`${raw}:${url}`).digest('hex')}.json`)
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < CACHE_TTL) return JSON.parse(fs.readFileSync(file, 'utf8'))
  if (remaining === 0) throw new RateLimited()

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'mianbook-topic-radar',
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  })
  requests++
  remaining = Number(res.headers.get('x-ratelimit-remaining') ?? remaining ?? 1)
  if ((res.status === 403 || res.status === 429) && remaining === 0) throw new RateLimited()
  const result = { status: res.status, body: res.ok ? (raw ? await res.text() : await res.json()) : null }
  if (res.ok || res.status === 404) {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(result))
  }
  // 礼貌一点：请求之间稍微停一下
  await new Promise((r) => setTimeout(r, 300))
  return result
}

interface SourceResult {
  source: Source
  license: string | null
  items: RadarItem[]
  error: string | null
}

async function collect(source: Source): Promise<SourceResult> {
  const result: SourceResult = { source, license: null, items: [], error: null }
  const repo = await gh(`/repos/${source.repo}`)
  if (repo.status !== 200) return { ...result, error: `仓库不存在或无法访问（${repo.status}）` }
  result.license = repo.body.license?.spdx_id ?? '未声明'
  const branch = repo.body.default_branch

  if (source.type === 'issues') {
    for (let page = 1; page <= (source.maxPages ?? 5); page++) {
      const res = await gh(`/repos/${source.repo}/issues?state=all&per_page=100&page=${page}&sort=created&direction=asc`)
      if (res.status !== 200) break
      for (const issue of res.body as any[]) {
        if (issue.pull_request) continue
        const text = cleanTitle(issue.title)
        // issue 里也有讨论、勘误之类的帖子，只收像问题的标题
        if (looksLikeQuestion(text)) result.items.push({ text, source: source.id, url: issue.html_url })
      }
      if ((res.body as any[]).length < 100) break
    }
    return result
  }

  const filter = source.fileFilter ? new RegExp(source.fileFilter, 'i') : null
  for (const p of source.paths ?? []) {
    const listing = await gh(`/repos/${source.repo}/contents/${encodeURI(p)}`)
    if (listing.status !== 200) {
      result.error = `${p} 不存在（${listing.status}）`
      continue
    }
    const files = Array.isArray(listing.body)
      ? listing.body.filter((f: any) => f.type === 'file' && f.name.endsWith('.md') && (!filter || filter.test(f.name))).map((f: any) => f.path)
      : [listing.body.path]
    for (const file of files) {
      const content = await gh(`/repos/${source.repo}/contents/${encodeURI(file)}`, true)
      if (content.status !== 200) continue
      const url = `https://github.com/${source.repo}/blob/${branch}/${file}`
      for (const text of extractQuestions(String(content.body))) result.items.push({ text, source: source.id, url })
    }
  }
  return result
}

// ---------- 题库：题目标题和每道题的追问 ----------

interface BankEntry {
  text: string
  title: string
  category: string
  path: string
  grams: Set<string>
}

function loadBank(): { entries: BankEntry[]; chunks: BankEntry[]; categoryTitles: Map<string, string> } {
  const outline: { slug: string; categories: { slug: string; title: string }[] }[] = JSON.parse(fs.readFileSync(path.join(root, 'content/outline.json'), 'utf8'))
  const categoryTitles = new Map<string, string>()
  const entries: BankEntry[] = []
  /** 每道题按小节切开的正文，用来判断某个话题有没有在正文里讲到 */
  const chunks: BankEntry[] = []
  for (const part of outline) {
    for (const cat of part.categories) {
      const key = `${part.slug}/${cat.slug}`
      categoryTitles.set(key, cat.title)
      const dir = path.join(root, 'content', part.slug, cat.slug)
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
        const md = fs.readFileSync(path.join(dir, f), 'utf8')
        const title = md.match(/^# (.+)$/m)?.[1]?.replace(/`/g, '') ?? f
        const body = md.replace(/^---[\s\S]*?---\s*/, '').replace(/^# .+$/m, '')
        const qpath = `/${key}/${f.replace(/\.md$/, '')}`
        const add = (text: string) => entries.push({ text, title, category: key, path: qpath, grams: grams(text) })
        add(title)
        for (const c of chunkQuestion(body)) {
          if (c.heading.startsWith('追问：')) add(c.heading.slice(3))
          chunks.push({ text: c.heading, title, category: key, path: qpath, grams: grams(`${title} ${c.heading} ${c.text}`) })
        }
      }
    }
  }
  return { entries, chunks, categoryTitles }
}

// ---------- 主流程 ----------

const sources: Source[] = JSON.parse(fs.readFileSync(path.join(root, 'scripts/radar-sources.json'), 'utf8'))
const results: SourceResult[] = []
let stopped = false
for (const source of sources) {
  if (stopped) {
    results.push({ source, license: null, items: [], error: '没抓：GitHub 请求限额用完了' })
    continue
  }
  try {
    const r = await collect(source)
    results.push(r)
    console.log(`${source.name}：${r.items.length} 条${r.error ? `（${r.error}）` : ''}`)
  } catch (error) {
    if (!(error instanceof RateLimited)) throw error
    stopped = true
    results.push({ source, license: null, items: [], error: '没抓完：GitHub 请求限额用完了' })
    console.log(`${source.name}：GitHub 请求限额用完了`)
  }
}

const { entries, chunks, categoryTitles } = loadBank()
const indexOf = (list: BankEntry[]) => {
  const index = new Map<string, number[]>()
  list.forEach((e, i) => e.grams.forEach((g) => (index.get(g) ?? index.set(g, []).get(g)!).push(i)))
  return index
}
const bankIndex = indexOf(entries)
const chunkIndex = indexOf(chunks)

/** 正文里讲得最全的一段：这个话题的特征有多少比例出现在同一段里 */
function bestChunk(text: string): { entry: BankEntry | null; score: number } {
  const g = strongGrams(grams(text))
  const hits = new Map<number, number>()
  for (const k of g) for (const i of chunkIndex.get(k) ?? []) hits.set(i, (hits.get(i) ?? 0) + 1)
  let best = -1
  let most = 0
  for (const [i, n] of hits) if (n > most) [best, most] = [i, n]
  return best < 0 ? { entry: null, score: 0 } : { entry: chunks[best]!, score: containment(g, chunks[best]!.grams) }
}

/** 题库里和这句话最像的条目 */
function bestMatch(text: string): { entry: BankEntry | null; score: number } {
  const g = grams(text)
  const candidates = new Set<number>()
  for (const k of g) for (const i of bankIndex.get(k) ?? []) candidates.add(i)
  let best: BankEntry | null = null
  let score = 0
  for (const i of candidates) {
    const s = similarity(g, entries[i]!.grams)
    if (s > score) {
      score = s
      best = entries[i]!
    }
  }
  return { entry: best, score }
}

// 判断覆盖：标题或追问和它说法相近（相似度），或者它的关键词全都出现在题库同一段正文里（包含度）
const COVERED = 0.55
const PARTIAL = 0.35
const TEXT_COVERED = 0.9
const TEXT_PARTIAL = 0.7
type Coverage = 'covered' | 'partial' | 'gap'

interface Analyzed extends RadarCluster {
  coverage: Coverage
  /** 标题相似度、正文包含度 */
  titleScore: number
  textScore: number
  match: { title: string; path: string; by: 'title' | 'text' } | null
  category: string
}

const sourceById = new Map(sources.map((s) => [s.id, s]))
const collected = results.flatMap((r) => r.items)
const allItems = collected.filter((i) => !isNoise(i.text))
const round2 = (n: number) => Math.round(n * 100) / 100
const analyzed: Analyzed[] = clusterItems(allItems).map((c) => {
  // 话题里任何一种说法和题库足够像，就算覆盖了
  let byTitle = { entry: null as BankEntry | null, score: 0 }
  let byText = { entry: null as BankEntry | null, score: 0 }
  for (const item of c.items) {
    const t = bestMatch(item.text)
    if (t.score > byTitle.score) byTitle = t
    if (strongGrams(grams(item.text)).size >= 3) {
      const x = bestChunk(item.text)
      if (x.score > byText.score) byText = x
    }
  }
  const coverage: Coverage =
    byTitle.score >= COVERED || byText.score >= TEXT_COVERED ? 'covered' : byTitle.score >= PARTIAL || byText.score >= TEXT_PARTIAL ? 'partial' : 'gap'
  const useText = byText.score >= TEXT_PARTIAL && byText.score - TEXT_PARTIAL > byTitle.score - PARTIAL
  const best = useText ? byText : byTitle
  const confident = byTitle.score >= PARTIAL || byText.score >= TEXT_PARTIAL
  const fallback = c.items.map((i) => sourceById.get(i.source)?.defaultCategory).find(Boolean) ?? null
  const category = guessCategory(c.title) ?? (confident && best.entry ? best.entry.category : null) ?? fallback ?? 'other'
  return {
    ...c,
    coverage,
    titleScore: round2(byTitle.score),
    textScore: round2(byText.score),
    match: best.entry ? { title: best.entry.title, path: best.entry.path, by: useText ? 'text' : 'title' } : null,
    category,
  }
})

// ---------- 报告 ----------

const count = (c: Coverage) => analyzed.filter((a) => a.coverage === c).length
const pct = (n: number) => `${analyzed.length ? Math.round((n / analyzed.length) * 100) : 0}%`
const label = (key: string) => categoryTitles.get(key) ?? (key === 'other' ? '其他' : key)
const sourceName = new Map(sources.map((s) => [s.id, s.name]))
const line = (a: Analyzed) => {
  const near = a.match
    ? `；最接近的已有题：[${a.match.title}](${a.match.path})（${a.match.by === 'text' ? `正文包含度 ${a.textScore}` : `标题相似度 ${a.titleScore}`}）`
    : ''
  const links = [...new Map(a.items.map((i) => [i.source, i])).values()].map((i) => `[${sourceName.get(i.source)}](${i.url})`).join('、')
  return `- **${a.title}**：${a.sources} 个来源${near}\n  ${links}`
}

function byCategory(list: Analyzed[], perCategory: number) {
  const groups = new Map<string, Analyzed[]>()
  for (const a of list) groups.set(a.category, [...(groups.get(a.category) ?? []), a])
  return [...groups]
    .sort((x, y) => y[1].length - x[1].length)
    .map(([cat, items]) => `### ${label(cat)}（${items.length}）\n\n${items.slice(0, perCategory).map(line).join('\n')}${items.length > perCategory ? `\n- ……还有 ${items.length - perCategory} 个` : ''}`)
    .join('\n\n')
}

const hotGaps = analyzed.filter((a) => a.coverage === 'gap' && a.sources >= 2)
const hotPartial = analyzed.filter((a) => a.coverage === 'partial' && a.sources >= 2)
const coldGaps = analyzed.filter((a) => a.coverage === 'gap' && a.sources === 1)

const md = [
  `# 选题雷达（${new Date().toISOString().slice(0, 10)}）`,
  '',
  `来源 ${results.length} 个（成功 ${results.filter((r) => r.items.length).length} 个）· 收集到 ${collected.length} 条题目（去掉 ${collected.length - allItems.length} 条离开正文就看不懂的，比如"写出下面代码的输出"）· 合并成 ${analyzed.length} 个话题 · 对比题库 ${new Set(entries.map((e) => e.path)).size} 道题（含追问 ${entries.length} 条）`,
  '',
  `已覆盖 ${pct(count('covered'))} · 部分覆盖 ${pct(count('partial'))} · 没覆盖 ${pct(count('gap'))}（标题或追问的相似度到 ${COVERED}、或者关键词全都出现在题库同一段正文里，算覆盖；相似度到 ${PARTIAL}、或者 ${TEXT_PARTIAL * 100}% 的关键词出现在同一段里，算部分覆盖。只比文字，换了术语的说法会被低估）`,
  '',
  `## 多个来源都在问、题库里没有的题（${hotGaps.length} 个）`,
  '',
  hotGaps.length ? byCategory(hotGaps, 30) : '没有。',
  '',
  `## 多个来源都在问、题库里只有相近的题（${hotPartial.length} 个）`,
  '',
  '可能是同一道题换了说法，也可能角度不同，值得看一眼。',
  '',
  hotPartial.length ? byCategory(hotPartial, 15) : '没有。',
  '',
  `## 只有一个来源问到、题库里没有的题（${coldGaps.length} 个，每个分类列前 10 个）`,
  '',
  coldGaps.length ? byCategory(coldGaps, 10) : '没有。',
  '',
  '## 来源',
  '',
  '| 来源 | 许可证 | 题目数 | 说明 |',
  '| --- | --- | --- | --- |',
  ...results.map((r) => `| [${r.source.name}](https://github.com/${r.source.repo}) | ${r.license ?? '—'} | ${r.items.length} | ${r.error ?? ''} |`),
  '',
  '只用于选题：这里收集的是题目标题，写进题库的解析要自己写，不要照搬来源里的答案。',
  '',
].join('\n')

const outDir = path.join(root, 'reports')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'topic-radar.md'), md)
fs.writeFileSync(path.join(outDir, 'topic-radar.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sources: results.map(({ items, ...r }) => ({ ...r, count: items.length })), topics: analyzed }, null, 2))

console.log(`\n收集 ${allItems.length} 条，合并成 ${analyzed.length} 个话题：已覆盖 ${pct(count('covered'))}，部分覆盖 ${pct(count('partial'))}，没覆盖 ${pct(count('gap'))}`)
console.log(`多个来源都在问、题库里没有：${hotGaps.length} 个`)
console.log(`这次请求 GitHub ${requests} 次${remaining !== null ? `，本小时还剩 ${remaining} 次` : ''}`)
console.log('报告：reports/topic-radar.md')
