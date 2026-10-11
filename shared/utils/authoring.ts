/**
 * 整理 AI 生成的题目正文：模型偶尔会用代码块把整篇包起来，或者带上 frontmatter、一级标题，
 * 这些在后台编辑器里都不需要
 */
export function cleanGeneratedMarkdown(text: string): string {
  let s = text.trim()
  const fenced = s.match(/^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/i)
  if (fenced) s = fenced[1]!.trim()
  s = s.replace(/^---\n[\s\S]*?\n---\n*/, '')
  s = s.replace(/^#\s+[^\n]*\n+/, '')
  return `${s.trim()}\n`
}
