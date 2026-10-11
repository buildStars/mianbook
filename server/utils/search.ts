import { eq } from 'drizzle-orm'
import MiniSearch from 'minisearch'
import type { SearchHit } from '#shared/types/handbook'

interface SearchDoc {
  id: number
  title: string
  tags: string
  text: string
  path: string
  part: string
  category: string
}

// 中文没有空格分词，用 Intl.Segmenter 按词切分
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
function tokenize(text: string): string[] {
  const words: string[] = []
  for (const s of segmenter.segment(text)) if (s.isWordLike) words.push(s.segment)
  return words
}

let indexPromise: Promise<{ index: MiniSearch<SearchDoc>; docs: Map<number, SearchDoc> }> | null = null

export function invalidateSearchIndex() {
  indexPromise = null
}

async function buildIndex() {
  const outline = await getOutline()
  const rows = await useDb()
    .select({ id: tables.questions.id, text: tables.questions.contentText, tags: tables.questions.tags })
    .from(tables.questions)
    .where(eq(tables.questions.status, 'published'))
  const content = new Map(rows.map((r) => [r.id, r]))

  const docs = new Map<number, SearchDoc>()
  for (const part of outline) {
    for (const cat of part.categories) {
      for (const q of cat.questions) {
        const row = content.get(q.id)
        docs.set(q.id, {
          id: q.id,
          title: q.title.replace(/`/g, ''),
          tags: row?.tags.join(' ') ?? '',
          text: row?.text ?? '',
          path: q.path,
          part: part.title,
          category: cat.title,
        })
      }
    }
  }

  const index = new MiniSearch<SearchDoc>({
    fields: ['title', 'tags', 'text'],
    tokenize,
    processTerm: (term) => term.toLowerCase(),
    searchOptions: { boost: { title: 4, tags: 2 }, prefix: true, fuzzy: 0.1 },
  })
  index.addAll([...docs.values()])
  return { index, docs }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 截取命中词附近的一段正文，命中词用 <mark> 标出（其余内容已转义） */
function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase()
  const positions = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0)
  const at = positions.length ? Math.min(...positions) : 0
  const start = Math.max(0, at - 24)
  const piece = text.slice(start, start + 96)
  let html = escapeHtml(piece)
  for (const term of [...new Set(terms)].sort((a, b) => b.length - a.length)) {
    const escaped = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    html = html.replace(new RegExp(escaped, 'gi'), (m) => `<mark>${m}</mark>`)
  }
  return `${start > 0 ? '…' : ''}${html}${start + 96 < text.length ? '…' : ''}`
}

export async function searchQuestions(query: string, limit = 20): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []
  indexPromise ??= buildIndex().catch((error) => {
    indexPromise = null
    throw error
  })
  const { index, docs } = await indexPromise

  // 先要求所有词都命中，没有结果再放宽为任一词命中
  let results = index.search(q, { combineWith: 'AND' })
  if (!results.length) results = index.search(q, { combineWith: 'OR' })

  return results.slice(0, limit).map((r) => {
    const doc = docs.get(r.id as number)!
    return {
      id: doc.id,
      title: doc.title,
      path: doc.path,
      part: doc.part,
      category: doc.category,
      snippet: snippet(doc.text, r.terms),
    }
  })
}
