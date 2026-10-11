import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { MOCK_DIFFICULTIES, MOCK_TRACKS } from '#shared/utils/mock-tracks'
import type {
  InterviewTurn,
  MockConfig,
  MockItem,
  MockQuestionInfo,
  MockSessionDetail,
  MockSessionSummary,
  OutlineQuestion,
} from '#shared/types/handbook'

type SessionRow = typeof tables.mockSessions.$inferSelect

const DIFFICULTY_OF: Record<MockConfig['difficulty'], number[]> = {
  basic: [1],
  advanced: [2],
  deep: [3],
  mixed: [1, 2, 3],
}

/** 方向预设里的分类映射成分类 id；focus 是重点分类的 id */
export async function trackCategoryIds(trackId: string): Promise<{ ids: number[]; focus: number[] }> {
  const track = MOCK_TRACKS.find((t) => t.id === trackId)
  if (!track) return { ids: [], focus: [] }
  const outline = await getOutline()
  const idOf = new Map<string, number>()
  for (const part of outline) for (const cat of part.categories) idOf.set(`${part.slug}/${cat.slug}`, cat.id)
  const pick = (keys: string[]) => keys.map((k) => idOf.get(k)).filter((id): id is number => id !== undefined)
  return { ids: pick(track.categories), focus: pick(track.focus ?? []) }
}

/** 按权重随机取一个元素的下标 */
function weightedIndex(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!
    if (r <= 0) return i
  }
  return weights.length - 1
}

/**
 * 抽题：在选中的分类里按难度筛选，各分类轮流抽，尽量覆盖不同知识点。
 * 选了"优先薄弱题"时，不会、模糊和今天到期的题权重更高；最近两周模拟面试里答过的题权重降低。
 * 结果按难度从低到高排，先热身再深入
 */
export async function pickQuestions(userId: number, config: MockConfig, focus: number[] = []): Promise<number[]> {
  const db = useDb()
  const outline = await getOutline()
  const wanted = new Set(config.categoryIds)
  const levels = DIFFICULTY_OF[config.difficulty]

  const byCategory = new Map<number, OutlineQuestion[]>()
  const all: OutlineQuestion[] = []
  for (const part of outline)
    for (const cat of part.categories) {
      if (!wanted.has(cat.id)) continue
      byCategory.set(cat.id, cat.questions)
      all.push(...cat.questions)
    }

  const since = new Date(Date.now() - 14 * 86_400_000)
  const [records, dueRows, recentSessions] = await Promise.all([
    db
      .select({ questionId: tables.studyRecords.questionId, status: tables.studyRecords.status })
      .from(tables.studyRecords)
      .where(eq(tables.studyRecords.userId, userId)),
    db
      .select({ questionId: tables.reviewCards.questionId })
      .from(tables.reviewCards)
      .where(and(eq(tables.reviewCards.userId, userId), lt(tables.reviewCards.due, new Date(Date.now() + 86_400_000)))),
    db
      .select({ items: tables.mockSessions.items })
      .from(tables.mockSessions)
      .where(and(eq(tables.mockSessions.userId, userId), gte(tables.mockSessions.createdAt, since))),
  ])
  const weak = new Set(records.filter((r) => r.status === 'weak' || r.status === 'fuzzy').map((r) => r.questionId))
  const due = new Set(dueRows.map((r) => r.questionId))
  const recent = new Set(recentSessions.flatMap((s) => s.items.map((i) => i.questionId).filter((id) => id !== null)))

  const weightOf = (q: OutlineQuestion) => {
    let w = 1
    if (config.preferWeak && (weak.has(q.id) || due.has(q.id))) w *= 4
    if (recent.has(q.id)) w *= 0.15
    return w
  }

  // 每个分类先按难度筛选；整体不够时放宽难度
  const pools = [...byCategory.values()].map((qs) => qs.filter((q) => levels.includes(q.difficulty)))
  if (pools.flat().length < config.count) pools.splice(0, pools.length, ...[...byCategory.values()].map((qs) => [...qs]))

  const picked: OutlineQuestion[] = []
  /** 在给定的几个分类之间轮流抽，直到抽够 quota 道或抽完 */
  const roundRobin = (indexes: number[], quota: number) => {
    const order = [...indexes].sort(() => Math.random() - 0.5)
    const target = picked.length + quota
    while (picked.length < target && order.some((i) => pools[i]!.length)) {
      for (const i of order) {
        const pool = pools[i]!
        if (!pool.length || picked.length >= target) continue
        picked.push(pool.splice(weightedIndex(pool.map(weightOf)), 1)[0]!)
      }
    }
  }
  // 有重点分类时（比如 Go 后端的 Go），先从重点分类抽约 4 成，其余分类轮流抽，最后不够再全部补
  const catIds = [...byCategory.keys()]
  const focusIdx = catIds.map((id, i) => (focus.includes(id) ? i : -1)).filter((i) => i >= 0)
  const otherIdx = catIds.map((_, i) => i).filter((i) => !focusIdx.includes(i))
  if (focusIdx.length && otherIdx.length) {
    roundRobin(focusIdx, Math.ceil(config.count * 0.4))
    roundRobin(otherIdx, config.count - picked.length)
  }
  roundRobin(catIds.map((_, i) => i), config.count - picked.length)
  if (!picked.length && all.length) picked.push(all[Math.floor(Math.random() * all.length)]!)
  return picked.sort((a, b) => a.difficulty - b.difficulty).map((q) => q.id)
}

export function sessionTitle(config: MockConfig): string {
  if (config.mode === 'resume') return `按简历出题 · ${config.role?.trim() || '项目深挖'} · ${config.count} 题`
  const track = MOCK_TRACKS.find((t) => t.id === config.track)?.name ?? '自选分类'
  const level = MOCK_DIFFICULTIES.find((d) => d.value === config.difficulty)?.label ?? ''
  return `${track} · ${level} · ${config.count} 题`
}

/** 一道题的得分：各轮平均，四舍五入到一位小数；跳过记 0 分 */
export function itemScore(item: MockItem): number | null {
  if (item.skipped) return 0
  const scores = item.scores.filter((s): s is number => s !== null)
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null
}

export function sessionScore(items: MockItem[]): number | null {
  const scores = items.filter((i) => i.done).map(itemScore).filter((s): s is number => s !== null)
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null
}

export function toSummary(row: SessionRow): MockSessionSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    count: row.items.length,
    answered: row.items.filter((i) => i.done).length,
    score: row.score ?? sessionScore(row.items),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

export async function getMockSession(userId: number, id: number): Promise<SessionRow> {
  const [row] = await useDb()
    .select()
    .from(tables.mockSessions)
    .where(and(eq(tables.mockSessions.id, id), eq(tables.mockSessions.userId, userId)))
  if (!row) throw createError({ statusCode: 404, message: '这场模拟面试不存在' })
  return row
}

export async function sessionDetail(row: SessionRow): Promise<MockSessionDetail> {
  const outline = await getOutline()
  const info = new Map<number, MockQuestionInfo>()
  for (const part of outline)
    for (const cat of part.categories)
      for (const q of cat.questions)
        info.set(q.id, { id: q.id, num: q.num, title: q.title, path: q.path, category: cat.title, difficulty: q.difficulty })

  const interviewIds = row.items.map((i) => i.interviewId).filter((id): id is number => id !== null)
  const turnsById = new Map<number, InterviewTurn[]>()
  if (interviewIds.length) {
    const rows = await useDb()
      .select({ id: tables.interviews.id, turns: tables.interviews.turns })
      .from(tables.interviews)
      .where(inArray(tables.interviews.id, interviewIds))
    for (const r of rows) turnsById.set(r.id, r.turns)
  }

  return {
    ...toSummary(row),
    config: row.config,
    currentIndex: row.currentIndex,
    report: row.report,
    items: row.items.map((item) => {
      // 按简历生成的题：没有题库链接，问答记录存在 item 自己身上
      if (item.custom) {
        return {
          ...item,
          question: { id: 0, num: 0, title: item.custom.title, path: '', category: '项目深挖', difficulty: 0 },
          turns: item.turns ?? [],
          points: item.custom.points,
        }
      }
      return {
        ...item,
        question: info.get(item.questionId ?? 0) ?? {
          id: item.questionId ?? 0,
          num: 0,
          title: '（题目已下线）',
          path: '',
          category: '',
          difficulty: 0,
        },
        turns: item.interviewId ? (turnsById.get(item.interviewId) ?? []) : [],
        points: null,
      }
    }),
  }
}

export function saveItems(id: number, items: MockItem[], extra: Partial<SessionRow> = {}) {
  return useDb()
    .update(tables.mockSessions)
    .set({ items, ...extra })
    .where(eq(tables.mockSessions.id, id))
}
