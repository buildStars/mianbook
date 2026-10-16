/**
 * 题目 Markdown 的格式检查规则（写作规范的机器检查部分）。
 * 纯函数：命令行脚本 scripts/check-content.mjs、后台编辑页的实时检查都用这一份
 */

export const QUESTION_TAGS = ['高频', '原理', '实践', '性能优化', '场景题', '手写题', '安全', '输出题', '综合', '系统设计', '新特性', '新技术', '对比']

const BANNED = ['首先', '其次', '总之', '值得注意的是', '综上所述', '众所周知']
const REQUIRED_SECTIONS = ['详细解析', '面试官可能追问', '易错点']
// 和 server/utils/markdown.ts 的 LANGS 对应（含 Shiki 的常用别名），其他语言不会高亮
const LANGS = new Set(['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx', 'vue', 'vue-html', 'html', 'css', 'scss', 'less', 'json', 'bash', 'sh', 'shell', 'nginx', 'python', 'py', 'sql', 'yaml', 'yml', 'diff', 'markdown', 'md', 'java', 'go', 'c', 'lua', 'xml', 'properties', 'ini', 'toml', 'dockerfile', 'text'])

export interface LintIssue {
  /** 文件里的行号（从 1 开始）；整篇的问题没有行号 */
  line?: number
  message: string
}

export interface LintResult {
  /** 必须改的问题 */
  problems: LintIssue[]
  /** 建议改的问题 */
  warnings: LintIssue[]
  lines: number
}

/** 去掉行内代码，避免误报 */
const stripInlineCode = (line: string) => line.replace(/`+[^`]*`+/g, '``')

/** 表格的列数。按 GFM 规则，反引号里的 | 也会拆分单元格，必须写成 \| */
function countCells(row: string) {
  let count = 0
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '|' && row[i - 1] !== '\\') count++
  }
  return count - 1
}

/**
 * 检查一个完整的题目文件（frontmatter + 一级标题 + 正文）。
 * linkExists 用来判断站内链接 /部分/分类/slug 是否存在，不传时不检查链接
 */
export function lintQuestionMarkdown(
  src: string,
  options: { expectedTitle?: string; linkExists?: (path: string) => boolean } = {},
): LintResult {
  const problems: LintIssue[] = []
  const warnings: LintIssue[] = []
  const at = (list: LintIssue[], line: number, message: string) => list.push({ line, message })
  const lines = src.split(/\r?\n/)

  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fm) problems.push({ message: '缺少 frontmatter' })
  else {
    const d = fm[1]!.match(/^difficulty:\s*(\d)\s*$/m)
    if (!d || !['1', '2', '3'].includes(d[1]!)) problems.push({ message: 'difficulty 不是 1～3' })
    const tags = fm[1]!.match(/^tags:\s*\[(.*)\]\s*$/m)
    if (!tags) problems.push({ message: 'tags 格式不对' })
    else {
      const unknown = tags[1]!
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && !QUESTION_TAGS.includes(t))
      if (unknown.length) warnings.push({ message: `标签不在词表里：${unknown.join('、')}` })
    }
    const extra = [...fm[1]!.matchAll(/^(\w+):/gm)].map((m) => m[1]!).filter((k) => !['difficulty', 'tags', 'sort', 'status'].includes(k))
    if (extra.length) warnings.push({ message: `frontmatter 多余字段：${extra.join(', ')}` })
  }

  const bodyStart = fm ? fm[0].split(/\r?\n/).length : 0
  let inFence = false
  let fenceMarker = ''
  let depth = 0
  const h1s: { n: number; text: string }[] = []
  const h2s: string[] = []
  let section = ''
  let followups = 0
  let tableCols: number | null = null

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i]!.trimEnd()
    const n = i + 1
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1]!
        const lang = line.trim().slice(fenceMarker.length).trim().split(/\s+/)[0]
        if (!lang) at(warnings, n, '代码块没有标注语言')
        else if (!LANGS.has(lang.toLowerCase())) at(warnings, n, `代码块语言 ${lang} 不在高亮列表里，见 server/utils/markdown.ts`)
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
      if (depth > 1) at(problems, n, '::: 容器嵌套')
      if (/^:::\s*details\b/.test(line) && section === '面试官可能追问') followups++
    } else if (/^:::\s*$/.test(line)) {
      depth--
      if (depth < 0) {
        at(problems, n, '多余的 :::')
        depth = 0
      }
    }

    const prose = stripInlineCode(line)
    if (/\{\{|\}\}/.test(prose)) at(problems, n, '正文出现双花括号')
    if (/<[a-zA-Z!/][^>]*>/.test(prose)) at(problems, n, `正文出现 HTML 标签，请用反引号包起来：${line.trim().slice(0, 50)}`)
    for (const w of BANNED) if (line.includes(w)) at(warnings, n, `出现"${w}"`)
    if (/[“”‘’]/.test(line)) at(warnings, n, '用了中文弯引号，请改成 ""')

    if (/^\s*\|/.test(line)) {
      const cols = countCells(line.trim())
      if (tableCols === null) tableCols = cols
      else if (cols !== tableCols) at(problems, n, `表格这一行有 ${cols} 列，表头是 ${tableCols} 列`)
    } else tableCols = null

    if (options.linkExists) {
      for (const m of line.matchAll(/\]\((\/[^)\s#]*)(#[^)]*)?\)/g)) {
        if (!options.linkExists(m[1]!)) at(problems, n, `站内链接不存在 ${m[1]}`)
      }
    }
  }

  if (inFence) problems.push({ message: '代码块没有闭合' })
  if (depth !== 0) problems.push({ message: '::: 容器没有闭合' })
  if (h1s.length !== 1) problems.push({ message: `一级标题有 ${h1s.length} 个` })
  if (options.expectedTitle && h1s[0] && h1s[0].text !== options.expectedTitle) {
    problems.push({ message: `标题是「${h1s[0].text}」，清单里是「${options.expectedTitle}」` })
  }
  if (h1s[0]) {
    let j = h1s[0].n
    while (j < lines.length && !lines[j]!.trim()) j++
    if (!/^:::\s*tip\s+一句话回答\s*$/.test(lines[j] ?? '')) problems.push({ message: '一级标题后面不是"::: tip 一句话回答"' })
  }
  for (const s of REQUIRED_SECTIONS) if (!h2s.includes(s)) problems.push({ message: `缺少"## ${s}"` })
  if (followups < 3 || followups > 4) warnings.push({ message: `追问有 ${followups} 个（建议 3～4 个）` })
  if (lines.length < 50 || lines.length > 170) warnings.push({ message: `共 ${lines.length} 行（建议 60～140 行）` })
  return { problems, warnings, lines: lines.length }
}

/** 命令行输出用：带行号的问题写成"第 N 行：……" */
export const formatLintIssue = (issue: LintIssue) => (issue.line ? `第 ${issue.line} 行：${issue.message}` : issue.message)
