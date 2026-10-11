// 检查题目 Markdown 的格式：node scripts/check-content.mjs [分类 slug ...] [--plan=题目清单.json]
// 不传分类时检查 content/outline.json 里的全部分类。有错误时退出码为 1。
// --plan 的格式：{ "部分/分类": [{ "slug": "01-xxx", "title": "题目" }] }，用来核对文件是否齐全、标题是否一致
import fs from 'node:fs'
import path from 'node:path'
import { formatLintIssue, lintQuestionMarkdown } from '../shared/utils/question-lint.ts'

const root = path.resolve(import.meta.dirname, '..')
const contentDir = path.join(root, 'content')
const args = process.argv.slice(2)
const planArg = args.find((a) => a.startsWith('--plan='))
const only = args.filter((a) => !a.startsWith('--'))
const plan = planArg ? JSON.parse(fs.readFileSync(planArg.slice('--plan='.length), 'utf-8')) : {}

/** 检查一个文件：规则在 shared/utils/question-lint.ts，后台编辑页的实时检查也用它 */
function check(file, expectedTitle) {
  const result = lintQuestionMarkdown(fs.readFileSync(file, 'utf-8'), {
    expectedTitle,
    linkExists: (p) => fs.existsSync(path.join(contentDir, `${p}.md`)),
  })
  return { problems: result.problems.map(formatLintIssue), warnings: result.warnings.map(formatLintIssue), lines: result.lines }
}

const outline = JSON.parse(fs.readFileSync(path.join(contentDir, 'outline.json'), 'utf-8'))
let total = 0
let bad = 0
for (const part of outline) {
  for (const cat of part.categories) {
    if (only.length && !only.includes(cat.slug)) continue
    const key = `${part.slug}/${cat.slug}`
    const dir = path.join(contentDir, part.slug, cat.slug)
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []
    const planned = plan[key] ?? []
    const missing = planned.filter((q) => !files.includes(`${q.slug}.md`)).map((q) => q.slug)
    console.log(`\n== ${key}：${files.length} 道${missing.length ? `，缺少 ${missing.join(', ')}` : ''}`)
    for (const f of files) {
      const slug = f.replace(/\.md$/, '')
      const { problems, warnings, lines } = check(path.join(dir, f), planned.find((q) => q.slug === slug)?.title)
      total++
      if (problems.length) bad++
      if (problems.length || warnings.length) {
        console.log(`  ${f}（${lines} 行）`)
        for (const p of problems) console.log(`    ✗ ${p}`)
        for (const w of warnings) console.log(`    · ${w}`)
      }
    }
  }
}
console.log(`\n共检查 ${total} 道题，${bad} 道有错误`)
process.exitCode = bad ? 1 : 0
