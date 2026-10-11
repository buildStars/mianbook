import { and, desc, eq, inArray } from 'drizzle-orm'

/** 每道题最多保留的历史版本数 */
const KEEP_VERSIONS = 50

export interface QuestionSnapshot {
  title: string
  difficulty: number
  tags: string[]
  status: 'draft' | 'published'
  contentMd: string
  updatedAt: Date
}

const sameSnapshot = (a: Omit<QuestionSnapshot, 'updatedAt'>, b: Omit<QuestionSnapshot, 'updatedAt'>) =>
  a.title === b.title &&
  a.difficulty === b.difficulty &&
  a.status === b.status &&
  a.contentMd === b.contentMd &&
  JSON.stringify(a.tags) === JSON.stringify(b.tags)

/** 题目现在的内容；保存前调用一次，留给 recordVersion 补存历史 */
export async function questionSnapshot(id: number): Promise<QuestionSnapshot | null> {
  const q = tables.questions
  const [row] = await useDb()
    .select({ title: q.title, difficulty: q.difficulty, tags: q.tags, status: q.status, contentMd: q.contentMd, updatedAt: q.updatedAt })
    .from(q)
    .where(eq(q.id, id))
  return row ?? null
}

/**
 * 保存后记一个版本。before 是保存前的内容：如果它和最近一个版本不一样
 * （还没有历史的老题目，或者被命令行导入改过），先把它补存为一个版本，这样改动前的内容永远能找回来
 */
export async function recordVersion(questionId: number, editorId: number | null, before?: QuestionSnapshot | null) {
  const db = useDb()
  const v = tables.questionVersions
  const [latest] = await db.select().from(v).where(eq(v.questionId, questionId)).orderBy(desc(v.createdAt), desc(v.id)).limit(1)

  let last: Omit<QuestionSnapshot, 'updatedAt'> | undefined = latest
  if (before && (!last || !sameSnapshot(last, before))) {
    const { updatedAt, ...snapshot } = before
    await db.insert(v).values({ questionId, ...snapshot, editorId: null, createdAt: updatedAt })
    last = snapshot
  }

  const after = await questionSnapshot(questionId)
  if (!after) return
  const { updatedAt: _, ...snapshot } = after
  if (last && sameSnapshot(last, snapshot)) return
  await db.insert(v).values({ questionId, ...snapshot, editorId })

  const stale = await db
    .select({ id: v.id })
    .from(v)
    .where(eq(v.questionId, questionId))
    .orderBy(desc(v.createdAt), desc(v.id))
    .offset(KEEP_VERSIONS)
    .limit(1000)
  if (stale.length) {
    await db.delete(v).where(and(eq(v.questionId, questionId), inArray(v.id, stale.map((s) => s.id))))
  }
}
