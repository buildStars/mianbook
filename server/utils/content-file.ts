import { parse as parseYaml } from 'yaml'

/** content/ 里一道题的 Markdown 文件：frontmatter + 一级标题 + 正文 */
export interface QuestionFile {
  title: string
  difficulty: number
  tags: string[]
  status: 'draft' | 'published'
  /** 文件里写了 sort 才有；没写时按文件名顺序排 */
  sort?: number
  /** 正文（不含一级标题），以换行结尾 */
  content: string
}

/** 拆出 frontmatter、一级标题和正文 */
export function parseQuestionFile(src: string, file: string): QuestionFile {
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const data = (fm ? parseYaml(fm[1]!) : null) ?? {}
  const body = fm ? src.slice(fm[0].length) : src
  const h1 = body.match(/^#\s+(.+)$/m)
  if (!h1) throw new Error(`${file} 缺少一级标题`)
  const content = body.slice(h1.index! + h1[0].length).trim()
  return {
    title: h1[1]!.trim(),
    difficulty: Math.min(3, Math.max(1, Number(data.difficulty) || 2)),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    status: data.status === 'draft' ? 'draft' : 'published',
    sort: typeof data.sort === 'number' ? data.sort : undefined,
    content: `${content}\n`,
  }
}

/** 序列化成和手写文件一致的格式；sort 只在和按文件名排的默认值不同时才写 */
export function serializeQuestionFile(q: QuestionFile): string {
  const front = [
    '---',
    `difficulty: ${q.difficulty}`,
    `tags: [${q.tags.join(', ')}]`,
    ...(q.sort !== undefined ? [`sort: ${q.sort}`] : []),
    ...(q.status === 'draft' ? ['status: draft'] : []),
    '---',
  ].join('\n')
  return `${front}\n\n# ${q.title}\n\n${q.content.trim()}\n`
}

/** 同一个文件夹里按文件名排序时，第 index 个文件默认的 sort */
export const defaultSort = (index: number) => (index + 1) * 10

export const byFileName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
