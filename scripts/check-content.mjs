// 检查题目 Markdown 的格式：node scripts/check-content.mjs [分类 slug ...] [--plan=题目清单.json]
// 不传分类时检查 content/outline.json 里的全部分类。有错误时退出码为 1。
// --plan 的格式：{ "部分/分类": [{ "slug": "01-xxx", "title": "题目" }] }，用来核对文件是否齐全、标题是否一致
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const contentDir = path.join(root, 'content')
const args = process.argv.slice(2)
const planArg = args.find((a) => a.startsWith('--plan='))
const only = args.filter((a) => !a.startsWith('--'))
const plan = planArg ? JSON.parse(fs.readFileSync(planArg.slice('--plan='.length), 'utf-8')) : {}

const BANNED = ['首先', '其次', '总之', '值得注意的是', '综上所述', '众所周知']
const REQUIRED_SECTIONS = ['详细解析', '面试官可能追问', '易错点']
const TAGS = ['高频', '原理', '实践', '性能优化', '场景题', '手写题', '安全', '输出题', '综合', '系统设计', '新特性', '新技术', '对比']
// 和 server/utils/markdown.ts 的 LANGS 对应（含 Shiki 的常用别名），其他语言不会高亮
const LANGS = new Set(['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx', 'vue', 'vue-html', 'html', 'css', 'json', 'bash', 'sh', 'shell', 'nginx', 'python', 'py', 'sql', 'yaml', 'yml', 'diff', 'markdown', 'md', 'java', 'go', 'lua', 'xml', 'properties', 'ini', 'toml', 'dockerfile', 'text'])

/** 去掉行内代码，避免误报 */
const stripInlineCode = (line) => line.replace(/`+[^`]*`+/g, '``')

/** 表格的列数。按 GFM 规则，反引号里的 | 也会拆分单元格，必须写成 \| */
function countCells(row) {
  let count = 0
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '|' && row[i - 1] !== '\\') count++
  }
  return count - 1
}

function check(file, expectedTitle) {
  const problems = []
  const warnings = []
  const src = fs.readFileSync(file, 'utf-8')
  const lines = src.split(/\r?\n/)

  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fm) problems.push('缺少 frontmatter')
  else {
    const d = fm[1].match(/^difficulty:\s*(\d)\s*$/m)
    if (!d || !['1', '2', '3'].includes(d[1])) problems.push('difficulty 不是 1～3')
    const tags = fm[1].match(/^tags:\s*\[(.*)\]\s*$/m)
    if (!tags) problems.push('tags 格式不对')
    else {
      const unknown = tags[1].split(',').map((t) => t.trim()).filter((t) => t && !TAGS.includes(t))
      if (unknown.length) warnings.push(`标签不在词表里：${unknown.join('、')}`)
    }
    const extra = [...fm[1].matchAll(/^(\w+):/gm)].map((m) => m[1]).filter((k) => !['difficulty', 'tags', 'sort', 'status'].includes(k))
    if (extra.length) warnings.push(`frontmatter 多余字段：${extra.join(', ')}`)
  }

  const bodyStart = fm ? fm[0].split(/\r?\n/).length : 0
  let inFence = false
  let fenceMarker = ''
  let depth = 0
  const h1s = []
  const h2s = []
  let section = ''
  let followups = 0
  let tableCols = null

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    const n = i + 1
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1]
        const lang = line.trim().slice(fenceMarker.length).trim().split(/\s+/)[0]
        if (!lang) warnings.push(`第 ${n} 行：代码块没有标注语言`)
        else if (!LANGS.has(lang.toLowerCase())) warnings.push(`第 ${n} 行：代码块语言 ${lang} 不在高亮列表里，见 server/utils/markdown.ts`)
      } else if (line.trim().startsWith(fenceMarker) && !line.trim().replace(/[`~]/g, '')) inFence = false
      continue
    }
    if (inFence) continue

    if (/^# /.test(line)) h1s.push({ n, text: line.slice(2).trim() })
    if (/^## /.test(line)) {
      section = line.slice(3).trim()
      h2s.push(section)
    }
    if (/^:::\s*\S/.test(line)) {
      depth++
      if (depth > 1) problems.push(`第 ${n} 行：::: 容器嵌套`)
      if (/^:::\s*details\b/.test(line) && section === '面试官可能追问') followups++
    } else if (/^:::\s*$/.test(line)) {
      depth--
      if (depth < 0) {
        problems.push(`第 ${n} 行：多余的 :::`)
        depth = 0
      }
    }

    const prose = stripInlineCode(line)
    if (/\{\{|\}\}/.test(prose)) problems.push(`第 ${n} 行：正文出现双花括号`)
    if (/<[a-zA-Z!/][^>]*>/.test(prose)) problems.push(`第 ${n} 行：正文出现 HTML 标签，请用反引号包起来：${line.trim().slice(0, 50)}`)
    for (const w of BANNED) if (line.includes(w)) warnings.push(`第 ${n} 行：出现"${w}"`)
    if (/[“”‘’]/.test(line)) warnings.push(`第 ${n} 行：用了中文弯引号，请改成 ""`)

    if (/^\s*\|/.test(line)) {
      const cols = countCells(line.trim())
      if (tableCols === null) tableCols = cols
      else if (cols !== tableCols) problems.push(`第 ${n} 行：表格这一行有 ${cols} 列，表头是 ${tableCols} 列`)
    } else tableCols = null

    for (const m of line.matchAll(/\]\((\/[^)\s#]*)(#[^)]*)?\)/g)) {
      if (!fs.existsSync(path.join(contentDir, `${m[1]}.md`))) problems.push(`第 ${n} 行：站内链接不存在 ${m[1]}`)
    }
  }

  if (inFence) problems.push('代码块没有闭合')
  if (depth !== 0) problems.push('::: 容器没有闭合')
  if (h1s.length !== 1) problems.push(`一级标题有 ${h1s.length} 个`)
  if (expectedTitle && h1s[0] && h1s[0].text !== expectedTitle) problems.push(`标题是「${h1s[0].text}」，清单里是「${expectedTitle}」`)
  if (h1s[0]) {
    let j = h1s[0].n
    while (j < lines.length && !lines[j].trim()) j++
    if (!/^:::\s*tip\s+一句话回答\s*$/.test(lines[j] ?? '')) problems.push('一级标题后面不是"::: tip 一句话回答"')
  }
  for (const s of REQUIRED_SECTIONS) if (!h2s.includes(s)) problems.push(`缺少"## ${s}"`)
  if (followups < 3 || followups > 4) warnings.push(`追问有 ${followups} 个（建议 3～4 个）`)
  if (lines.length < 50 || lines.length > 170) warnings.push(`共 ${lines.length} 行（建议 60～140 行）`)
  return { problems, warnings, lines: lines.length }
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
