import MarkdownIt from 'markdown-it'
import cjkFriendly from 'markdown-it-cjk-friendly'

let md: MarkdownIt | null = null

/**
 * 渲染大模型输出的 Markdown。模型输出可能被提示注入操纵，所以：
 * - 原始 HTML 一律转义（html: false）
 * - 禁用图片，防止通过图片地址把数据外传
 * - 链接在新标签页打开，javascript: 等危险协议由 markdown-it 默认拦截
 */
export function renderAiMarkdown(src: string): string {
  if (!md) {
    // cjkFriendly：修正中文标点旁的加粗判断，模型输出里很常见
    md = MarkdownIt({ html: false, linkify: false, breaks: true }).use(cjkFriendly).disable(['image'])
    const linkOpen =
      md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      tokens[idx]!.attrSet('target', '_blank')
      tokens[idx]!.attrSet('rel', 'noopener noreferrer nofollow')
      return linkOpen(tokens, idx, options, env, self)
    }
  }
  return md.render(src)
}

/** 去掉点评第一行的"得分：X/10"，得分单独展示 */
export const stripScoreLine = (text: string) => text.replace(/^\s*\**得分[^\n]*\n?/, '')
