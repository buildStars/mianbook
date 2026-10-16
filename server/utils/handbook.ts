import { asc, eq } from 'drizzle-orm'
import type { OutlinePart, OutlineQuestion, QuestionDetail } from '#shared/types/handbook'

let outlineCache: Promise<OutlinePart[]> | null = null

/** 题目、分类有变动时调用，清掉目录缓存和搜索索引，稍后同步问手册的检索索引 */
export function invalidateContent() {
  outlineCache = null
  invalidateSearchIndex()
  invalidateRetriever()
  scheduleRagSync()
}

async function loadOutline(): Promise<OutlinePart[]> {
  const db = useDb()
  const [parts, cats, qs] = await Promise.all([
    db.select().from(tables.parts).orderBy(asc(tables.parts.sort), asc(tables.parts.id)),
    db.select().from(tables.categories).orderBy(asc(tables.categories.sort), asc(tables.categories.id)),
    db
      .select({
        id: tables.questions.id,
        categoryId: tables.questions.categoryId,
        slug: tables.questions.slug,
        title: tables.questions.title,
        difficulty: tables.questions.difficulty,
      })
      .from(tables.questions)
      .where(eq(tables.questions.status, 'published'))
      .orderBy(asc(tables.questions.sort), asc(tables.questions.id)),
  ])

  // 题号按"部分 → 分类 → 题目"的顺序全局编号
  let num = 0
  return parts
    .map((part) => ({
      id: part.id,
      slug: part.slug,
      title: part.title,
      categories: cats
        .filter((c) => c.partId === part.id)
        .map((cat) => ({
          id: cat.id,
          slug: cat.slug,
          title: cat.title,
          questions: qs
            .filter((q) => q.categoryId === cat.id)
            .map((q) => ({
              id: q.id,
              num: ++num,
              slug: q.slug,
              title: q.title,
              difficulty: q.difficulty,
              path: `/${part.slug}/${cat.slug}/${q.slug}`,
            })),
        }))
        .filter((cat) => cat.questions.length > 0),
    }))
    .filter((part) => part.categories.length > 0)
}

export function getOutline(): Promise<OutlinePart[]> {
  outlineCache ??= loadOutline().catch((error) => {
    outlineCache = null
    throw error
  })
  return outlineCache
}

export interface LocatedQuestion {
  question: OutlineQuestion
  part: OutlinePart
  category: OutlinePart['categories'][number]
  /** 同一部分内的上一题、下一题 */
  prev: OutlineQuestion | null
  next: OutlineQuestion | null
}

export async function locateQuestion(match: (q: OutlineQuestion) => boolean): Promise<LocatedQuestion | null> {
  for (const part of await getOutline()) {
    const list = part.categories.flatMap((c) => c.questions.map((q) => ({ q, c })))
    const index = list.findIndex(({ q }) => match(q))
    if (index === -1) continue
    return {
      question: list[index]!.q,
      part,
      category: list[index]!.c,
      prev: list[index - 1]?.q ?? null,
      next: list[index + 1]?.q ?? null,
    }
  }
  return null
}

export async function getQuestionDetail(path: string): Promise<QuestionDetail | null> {
  const located = await locateQuestion((q) => q.path === path)
  if (!located) return null
  const [row] = await useDb().select().from(tables.questions).where(eq(tables.questions.id, located.question.id))
  if (!row) return null
  const link = (q: OutlineQuestion | null) => (q ? { title: q.title, path: q.path } : null)
  return {
    id: row.id,
    num: located.question.num,
    title: row.title,
    difficulty: row.difficulty,
    tags: row.tags,
    html: row.contentHtml,
    toc: row.toc,
    path,
    part: { slug: located.part.slug, title: located.part.title },
    category: { slug: located.category.slug, title: located.category.title },
    prev: link(located.prev),
    next: link(located.next),
    updatedAt: row.updatedAt.toISOString(),
  }
}
