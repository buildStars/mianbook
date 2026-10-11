import { fromHighlighter } from '@shikijs/markdown-it/core'
import MarkdownIt from 'markdown-it'
import cjkFriendly from 'markdown-it-cjk-friendly'
import container from 'markdown-it-container'
import { createHighlighter, type BundledLanguage } from 'shiki'
import type { TocItem } from '../../shared/types/handbook'

// 这个文件只依赖 npm 包，导入脚本（scripts/db.ts）也会直接复用

const LANGS = [
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'vue',
  'vue-html',
  'html',
  'css',
  'json',
  'bash',
  'nginx',
  'python',
  'sql',
  'yaml',
  'diff',
  'markdown',
  'java',
  'go',
  'lua',
  'xml',
  'properties',
  'ini',
  'toml',
  'dockerfile',
]

/**
 * Shiki 内置的纯文本语言。插件选项的类型只列了可加载的语言，没算上它，运行时是支持的（插件的 defaultLanguage 默认值就是它）。
 * 不能换成 'plaintext'：插件会把语言名写进代码块的 class，language-text 会变成 language-plaintext
 */
const PLAIN_TEXT = 'text' as BundledLanguage

const CONTAINER_TYPES = ['tip', 'info', 'warning', 'danger'] as const
const DEFAULT_TITLES: Record<string, string> = {
  tip: '提示',
  info: '信息',
  warning: '注意',
  danger: '警告',
  details: '展开',
}

/** 题目模板里的固定二级标题，渲染成带类型的 section，前端按类型排版。"代码示例：手写 new"这类也算代码示例 */
const SECTION_KINDS: [prefix: string, kind: string][] = [
  ['详细解析', 'analysis'],
  ['代码示例', 'code'],
  ['面试官可能追问', 'followups'],
  ['易错点', 'pitfalls'],
]

const sectionKind = (title: string) => SECTION_KINDS.find(([prefix]) => title.startsWith(prefix))?.[1]

/** "一句话回答"提示块单独排版 */
const ANSWER_TITLE = '一句话回答'

const LANG_LABELS: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  vue: 'Vue',
  'vue-html': 'Vue',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  bash: 'Shell',
  sh: 'Shell',
  shell: 'Shell',
  nginx: 'Nginx',
  python: 'Python',
  py: 'Python',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  diff: 'Diff',
  markdown: 'Markdown',
  md: 'Markdown',
  java: 'Java',
  go: 'Go',
  lua: 'Lua',
  xml: 'XML',
  properties: 'Properties',
  ini: 'INI',
  toml: 'TOML',
  dockerfile: 'Dockerfile',
}

/** 标题转锚点：保留字母（含中文）、数字、连字符 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/** 提取用于搜索的纯文本：去掉代码块和 Markdown 标记，保留追问标题 */
export function markdownToText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^:::\s*[\w-]+\s*(.*)$/gm, '$1')
    .replace(/^:::\s*$/gm, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, ' ')
    .replace(/[*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeAttr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

async function createRenderer() {
  const highlighter = await createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: LANGS,
  })

  // html: false —— 正文里的原始 HTML 一律转义，避免 XSS
  // cjkFriendly —— 修正 CommonMark 对中文的加粗判断，如 **指令微调（SFT）**用 原本不会加粗
  const md = MarkdownIt({ html: false, linkify: false, typographer: false }).use(cjkFriendly)

  md.use(
    fromHighlighter(highlighter, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultLanguage: PLAIN_TEXT,
      fallbackLanguage: PLAIN_TEXT,
    }),
  )

  // 代码块外面包一层，顶部是语言名和复制按钮（按钮的行为在前端统一处理）
  const fence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const lang = tokens[idx]!.info.trim().split(/\s+/)[0] || ''
    // text 代码块多用来画流程图、架构图或展示输出，标成"文本"
    const label = LANG_LABELS[lang.toLowerCase()] ?? (lang === 'text' ? '文本' : lang || '代码')
    return (
      `<div class="code-block" data-lang="${escapeAttr(lang)}">` +
      `<div class="code-head"><span class="code-dots" aria-hidden="true"><i></i><i></i><i></i></span>` +
      `<span class="code-lang">${md.utils.escapeHtml(label)}</span>` +
      `<button type="button" class="code-copy" aria-label="复制代码">复制</button></div>` +
      `${fence(tokens, idx, options, env, self)}</div>\n`
    )
  }

  // ::: tip 标题 / ::: warning / ::: danger / ::: info
  for (const type of CONTAINER_TYPES) {
    md.use(container, type, {
      render(tokens: any[], idx: number) {
        const token = tokens[idx]
        if (token.nesting !== 1) return '</div>\n'
        const title = token.info.trim().slice(type.length).trim() || DEFAULT_TITLES[type]
        const extra = type === 'tip' && title === ANSWER_TITLE ? ' answer' : ''
        return `<div class="${type} custom-block${extra}"><p class="custom-block-title">${md.renderInline(title)}</p>\n`
      },
    })
  }

  // ::: details 问题 —— 追问默认折叠
  md.use(container, 'details', {
    render(tokens: any[], idx: number) {
      const token = tokens[idx]
      if (token.nesting !== 1) return '</details>\n'
      const title = token.info.trim().slice('details'.length).trim() || DEFAULT_TITLES.details
      return `<details class="details custom-block"><summary>${md.renderInline(title)}</summary>\n`
    },
  })

  // 给标题加 id，同时收集二、三级标题作为本页目录
  md.core.ruler.push('heading_ids', (state) => {
    const seen = new Map<string, number>()
    const toc: TocItem[] = []
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!
      if (token.type !== 'heading_open') continue
      const inline = tokens[i + 1]!
      const text = (inline.children ?? [])
        .filter((t) => t.type === 'text' || t.type === 'code_inline')
        .map((t) => t.content)
        .join('')
        .trim()
      let id = slugify(text) || `section-${i}`
      const count = seen.get(id) ?? 0
      seen.set(id, count + 1)
      if (count) id = `${id}-${count}`
      token.attrSet('id', id)
      const level = Number(token.tag.slice(1))
      if (level === 2 || level === 3) toc.push({ level, id, text })
    }
    state.env.toc = toc
  })

  // 每个二级标题和它下面的内容包成一个 section，方便前端按类型排版（如追问编号、易错点列表）
  md.core.ruler.push('sections', (state) => {
    const html = (content: string) => {
      const token = new state.Token('html_block', '', 0)
      token.content = content
      return token
    }
    const out: typeof state.tokens = []
    let open = false
    state.tokens.forEach((token, i) => {
      if (token.type === 'heading_open' && token.tag === 'h2') {
        if (open) out.push(html('</section>\n'))
        const kind = sectionKind(state.tokens[i + 1]?.content.trim() ?? '')
        out.push(html(kind ? `<section class="doc-section" data-kind="${kind}">\n` : '<section class="doc-section">\n'))
        open = true
      }
      out.push(token)
    })
    if (open) out.push(html('</section>\n'))
    state.tokens = out
  })

  md.renderer.rules.heading_close = (tokens, idx) => {
    const id = tokens[idx - 2]?.attrGet('id')
    const anchor = id ? `<a class="header-anchor" href="#${escapeAttr(String(id))}" aria-hidden="true">#</a>` : ''
    return `${anchor}</${tokens[idx]!.tag}>\n`
  }

  // 表格外包一层，窄屏时可以横向滚动
  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n'
  md.renderer.rules.table_close = () => '</table></div>\n'

  // 外部链接在新标签页打开
  const linkOpen =
    md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = String(tokens[idx]!.attrGet('href') ?? '')
    if (/^https?:\/\//.test(href)) {
      tokens[idx]!.attrSet('target', '_blank')
      tokens[idx]!.attrSet('rel', 'noopener noreferrer')
    }
    return linkOpen(tokens, idx, options, env, self)
  }

  return md
}

let renderer: Promise<ReturnType<typeof MarkdownIt>> | undefined

export interface RenderedMarkdown {
  html: string
  toc: TocItem[]
  text: string
}

export async function renderMarkdown(src: string): Promise<RenderedMarkdown> {
  renderer ??= createRenderer()
  const md = await renderer
  const env: { toc?: TocItem[] } = {}
  const html = md.render(src, env)
  return { html, toc: env.toc ?? [], text: markdownToText(src) }
}
