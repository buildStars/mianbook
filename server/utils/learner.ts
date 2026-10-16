import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import type { StudyStatus } from '#shared/types/handbook'

/** 学习记录相关的查询：Agent 面试官和 MCP Server 的工具共用 */

export const STUDY_STATUS_LABEL: Record<StudyStatus, string> = { weak: '不会', fuzzy: '模糊', mastered: '掌握' }

export interface QuestionMeta {
  title: string
  category: string
  categorySlug: string
  part: string
  difficulty: number
  path: string
}

/** 已发布题目的标题、分类、难度和路径（来自目录缓存，不查库） */
export async function questionMeta(): Promise<Map<number, QuestionMeta>> {
  const outline = await getOutline()
  const meta = new Map<number, QuestionMeta>()
  for (const part of outline)
    for (const cat of part.categories)
      for (const q of cat.questions)
        meta.set(q.id, { title: q.title, category: cat.title, categorySlug: cat.slug, part: part.title, difficulty: q.difficulty, path: q.path })
  return meta
}

export interface LearningProfile {
  /** 学过的分类，薄弱的排在前面 */
  categories?: { category: string; total: number; mastered: number; fuzzy: number; weak: number; interviewAvgScore: number | null }[]
  /** 最近 AI 面试里 5 分及以下的题 */
  recentLowScores?: { questionId: number; title: string; score: number }[]
  /** 24 小时内到期要复习的题数 */
  dueToday: number
  /** 没有任何学习记录时的说明 */
  note?: string
}

/** 各分类的掌握情况、AI 面试平均分、到期复习数和最近的低分题 */
export async function learningProfile(userId: number): Promise<LearningProfile> {
  const db = useDb()
  const [meta, records, interviews, dueRows] = await Promise.all([
    questionMeta(),
    db
      .select({ questionId: tables.studyRecords.questionId, status: tables.studyRecords.status })
      .from(tables.studyRecords)
      .where(eq(tables.studyRecords.userId, userId)),
    db
      .select({ questionId: tables.interviews.questionId, turns: tables.interviews.turns })
      .from(tables.interviews)
      .where(eq(tables.interviews.userId, userId))
      .orderBy(desc(tables.interviews.updatedAt))
      .limit(200),
    db
      .select({ questionId: tables.reviewCards.questionId })
      .from(tables.reviewCards)
      .where(and(eq(tables.reviewCards.userId, userId), lt(tables.reviewCards.due, new Date(Date.now() + 86_400_000)))),
  ])

  const byCat = new Map<string, { category: string; total: number; mastered: number; fuzzy: number; weak: number; scores: number[] }>()
  for (const m of meta.values()) {
    const c = byCat.get(m.category) ?? { category: m.category, total: 0, mastered: 0, fuzzy: 0, weak: 0, scores: [] }
    c.total++
    byCat.set(m.category, c)
  }
  for (const r of records) {
    const m = meta.get(r.questionId)
    if (m && r.status) byCat.get(m.category)![r.status]++
  }
  // 每道题只看最近一次面试的第一轮得分
  const latest = new Map<number, number>()
  for (const row of interviews) {
    const score = row.turns[0]?.score
    if (!latest.has(row.questionId) && typeof score === 'number') latest.set(row.questionId, score)
  }
  for (const [qid, score] of latest) {
    const m = meta.get(qid)
    if (m) byCat.get(m.category)!.scores.push(score)
  }

  const studied = [...byCat.values()].filter((c) => c.mastered + c.fuzzy + c.weak + c.scores.length > 0)
  if (!studied.length) return { note: '还没有学习记录', dueToday: dueRows.length }

  const avg = (s: number[]) => (s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : null)
  return {
    categories: studied
      .map((c) => ({ category: c.category, total: c.total, mastered: c.mastered, fuzzy: c.fuzzy, weak: c.weak, interviewAvgScore: avg(c.scores) }))
      .sort((a, b) => b.weak + b.fuzzy - (a.weak + a.fuzzy) || (a.interviewAvgScore ?? 10) - (b.interviewAvgScore ?? 10))
      .slice(0, 15),
    recentLowScores: [...latest]
      .filter(([, s]) => s <= 5)
      .slice(0, 6)
      .map(([qid, score]) => ({ questionId: qid, title: meta.get(qid)?.title ?? '', score })),
    dueToday: dueRows.length,
  }
}

export interface FoundQuestion {
  id: number
  title: string
  category: string
  difficulty: number
  path: string
  /** 用户的掌握程度：不会、模糊、掌握、没学过 */
  studyStatus: string
}

/**
 * 找题：有关键词时用问手册的混合检索（检索索引还没建好时退回到普通搜索），没有时随机；
 * 再按分类、难度筛选。exclude 里的题（比如这场面试已经问过的）排到最后
 */
export async function findQuestions(
  userId: number,
  args: { query?: string; category?: string; difficulty?: number; limit?: number },
  exclude: Set<number> = new Set(),
): Promise<{ questions: FoundQuestion[]; error?: string; note?: string }> {
  const meta = await questionMeta()
  let ids: number[]
  if (args.query) {
    const found = await searchHandbook(args.query, { limit: 30, perQuestion: 1 })
    ids = found.hits.map((h) => h.chunk.questionId)
    if (!ids.length) ids = (await searchQuestions(args.query, 30)).map((h) => h.id)
  } else {
    // 不按关键词时打乱顺序，同样的条件每次能出不同的题
    ids = [...meta.keys()].sort(() => Math.random() - 0.5)
  }

  if (args.category) {
    const wanted = args.category.trim().toLowerCase()
    const matches = (m: QuestionMeta) => m.category.toLowerCase().includes(wanted) || m.categorySlug === wanted
    if (![...meta.values()].some(matches)) {
      const names = [...new Set([...meta.values()].map((m) => m.category))].join('、')
      return { questions: [], error: `没有"${args.category}"这个分类，可用的分类有：${names}` }
    }
    ids = ids.filter((id) => meta.has(id) && matches(meta.get(id)!))
  }
  if (args.difficulty) ids = ids.filter((id) => meta.get(id)?.difficulty === args.difficulty)
  ids = ids.filter((id) => meta.has(id))

  const records = ids.length
    ? await useDb()
        .select({ questionId: tables.studyRecords.questionId, status: tables.studyRecords.status })
        .from(tables.studyRecords)
        .where(and(eq(tables.studyRecords.userId, userId), inArray(tables.studyRecords.questionId, ids.slice(0, 200))))
    : []
  const status = new Map(records.map((r) => [r.questionId, r.status]))
  const questions = ids
    // 排除的排后面，其余保持检索的相关度顺序
    .sort((a, b) => Number(exclude.has(a)) - Number(exclude.has(b)))
    .slice(0, args.limit ?? 6)
    .map((id) => {
      const m = meta.get(id)!
      const s = status.get(id)
      return { id, title: m.title, category: m.category, difficulty: m.difficulty, path: m.path, studyStatus: s ? STUDY_STATUS_LABEL[s] : '没学过' }
    })
  return questions.length ? { questions } : { questions, note: '没有找到符合条件的题，换个关键词或去掉一些条件再试' }
}
