import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { MockDifficulty } from '#shared/types/handbook'
import { ToolError, type McpPrompt, type McpServerDef, type McpTool } from './mcp-protocol'

/** MCP 工具的上下文：令牌对应的用户、站点地址（拼题目链接用） */
export interface McpContext {
  userId: number
  baseUrl: string
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n))
/** 复习日期按北京时间显示，大部分用户在国内 */
const BEIJING = -480
const day = (d: Date) => localDate(d, BEIJING)
const plain = (title: string) => title.replace(/`/g, '')

async function questionOrThrow(questionId: number) {
  const meta = (await questionMeta()).get(questionId)
  if (!meta) throw new ToolError(`题目 ${questionId} 不存在或没有发布，请先用 find_questions 或 search_handbook 找到题目 id`)
  return meta
}

const searchHandbookTool: McpTool<McpContext> = {
  name: 'search_handbook',
  title: '检索手册',
  description:
    '在全栈面试手册里检索和问题相关的段落（关键词 + 向量混合检索），返回段落原文和题目链接。回答前端、后端、AI 应用开发的技术或面试问题前先调用它，回答时附上题目链接作为出处。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '要查的问题或知识点，用自然语言写，如"缓存击穿怎么解决"' },
      limit: { type: 'integer', minimum: 1, maximum: 8, description: '返回几段，默认 5' },
    },
    required: ['query'],
  },
  args: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(8).default(5) }),
  async run(ctx, { query, limit }) {
    const found = await searchHandbook(query, { limit, perQuestion: 2 })
    if (!found.hits.length) {
      // 刚部署、检索索引还没建好时，退回到按标题和正文的普通搜索
      const hits = await searchQuestions(query, limit)
      if (!hits.length) return '手册里没有找到相关内容。可以换个说法，或者用 find_questions 按分类找题。'
      const lines = hits.map((h) => `- 《${plain(h.title)}》（${h.category}，题目 id ${h.id}）${ctx.baseUrl}${h.path}\n  ${h.snippet.replace(/<\/?mark>/g, '')}`)
      return `找到 ${hits.length} 道相关的题（检索索引还在生成，下面是按标题和正文搜索的结果，可以用 get_question 看完整内容）：\n${lines.join('\n')}`
    }
    const blocks = found.hits.map(
      (h, i) =>
        `[${i + 1}] 《${plain(h.chunk.title)}》· ${h.chunk.heading}（${h.chunk.category}，题目 id ${h.chunk.questionId}）\n${ctx.baseUrl}${h.chunk.path}\n${h.chunk.text}`,
    )
    return `找到 ${found.hits.length} 段相关内容。回答时请附上对应的题目链接作为出处。\n\n${blocks.join('\n\n')}`
  },
}

const findQuestionsTool: McpTool<McpContext> = {
  name: 'find_questions',
  title: '找题',
  description: '按关键词、分类或难度在题库里找题，返回题目 id、标题、难度和用户的掌握程度，不含答案。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '知识点或场景，如"React 性能优化"；不填表示不限' },
      category: { type: 'string', description: '分类名，如 Redis、React、Go；不填表示不限' },
      difficulty: { type: 'integer', enum: [1, 2, 3], description: '1 基础、2 进阶、3 深入；不填表示不限' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: '最多返回几道，默认 10' },
    },
  },
  args: z.object({
    query: z.string().trim().max(100).optional(),
    category: z.string().trim().max(40).optional(),
    difficulty: z.number().int().min(1).max(3).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async run(ctx, args) {
    const found = await findQuestions(ctx.userId, args)
    if (found.error) throw new ToolError(found.error)
    if (!found.questions.length) return found.note ?? '没有找到符合条件的题'
    const lines = found.questions.map(
      (q) => `- [id ${q.id}] ${plain(q.title)}（${q.category} · 难度 ${stars(q.difficulty)} · 掌握程度：${q.studyStatus}）${ctx.baseUrl}${q.path}`,
    )
    return `找到 ${found.questions.length} 道题：\n${lines.join('\n')}`
  },
}

const getQuestionTool: McpTool<McpContext> = {
  name: 'get_question',
  title: '查看题目',
  description: '查看一道题的完整解析（Markdown，含一句话回答、详解、追问和易错点），以及用户的掌握程度、笔记和下次复习时间。考用户时用它对照参考答案打分，不要把原文整段发给用户。',
  inputSchema: {
    type: 'object',
    properties: { question_id: { type: 'integer', description: '题目 id' } },
    required: ['question_id'],
  },
  args: z.object({ question_id: z.number().int().positive() }),
  async run(ctx, { question_id }) {
    const meta = await questionOrThrow(question_id)
    const [[q], record, card] = await Promise.all([
      useDb()
        .select({ contentMd: tables.questions.contentMd, tags: tables.questions.tags })
        .from(tables.questions)
        .where(and(eq(tables.questions.id, question_id), eq(tables.questions.status, 'published'))),
      getStudyRecord(ctx.userId, question_id),
      getReviewCard(ctx.userId, question_id),
    ])
    if (!q) throw new ToolError(`题目 ${question_id} 不存在`)
    const mine = [
      `我的掌握程度：${record?.status ? STUDY_STATUS_LABEL[record.status] : '没标记'}${record?.starred ? '（已收藏）' : ''}`,
      card ? `下次复习：${day(card.due)}` : '还没加入复习计划',
    ].join(' · ')
    return [
      `# ${plain(meta.title)}`,
      `分类：${meta.part} / ${meta.category} · 难度 ${stars(meta.difficulty)}${q.tags.length ? ` · 标签：${q.tags.join('、')}` : ''}`,
      `链接：${ctx.baseUrl}${meta.path}`,
      mine,
      record?.note ? `我的笔记：${record.note}` : '',
      '---',
      q.contentMd.length > 12_000 ? `${q.contentMd.slice(0, 12_000)}\n\n（内容太长，后面省略了，完整内容见链接）` : q.contentMd,
    ]
      .filter(Boolean)
      .join('\n')
  },
}

const DIFFICULTY_NAMES = ['basic', 'advanced', 'deep', 'mixed'] as const

const pickQuizTool: McpTool<McpContext> = {
  name: 'pick_quiz_questions',
  title: '抽题',
  description:
    '按分类和难度抽几道题来考用户，默认优先抽用户标记为不会、模糊和今天该复习的题，最近练过的会少抽。只返回题目，不含答案：一次问一道，用户回答后用 get_question 查看参考答案打分，再用 record_result 记录。',
  inputSchema: {
    type: 'object',
    properties: {
      category: { type: 'string', description: '分类名，如 Redis、React、Go；不填表示所有分类' },
      count: { type: 'integer', minimum: 1, maximum: 10, description: '抽几道，默认 3' },
      difficulty: { type: 'string', enum: [...DIFFICULTY_NAMES], description: 'basic 基础、advanced 进阶、deep 深入、mixed 不限（默认）' },
      prefer_weak: { type: 'boolean', description: '优先抽薄弱和该复习的题，默认 true' },
    },
  },
  args: z.object({
    category: z.string().trim().max(40).optional(),
    count: z.number().int().min(1).max(10).default(3),
    difficulty: z.enum(DIFFICULTY_NAMES).default('mixed'),
    prefer_weak: z.boolean().default(true),
  }),
  async run(ctx, args) {
    const outline = await getOutline()
    const cats = outline.flatMap((p) => p.categories)
    let categoryIds = cats.map((c) => c.id)
    if (args.category) {
      const wanted = args.category.toLowerCase()
      categoryIds = cats.filter((c) => c.title.toLowerCase().includes(wanted) || c.slug === wanted).map((c) => c.id)
      if (!categoryIds.length) {
        throw new ToolError(`没有"${args.category}"这个分类。可用的分类有：${cats.map((c) => c.title).join('、')}。想按知识点找题请用 find_questions`)
      }
    }
    const ids = await pickQuestions(ctx.userId, {
      track: 'custom',
      categoryIds,
      difficulty: args.difficulty as MockDifficulty,
      count: args.count,
      followUps: 0,
      preferWeak: args.prefer_weak,
    })
    const meta = await questionMeta()
    const lines = ids.map((id, i) => {
      const m = meta.get(id)!
      return `${i + 1}. [id ${id}] ${plain(m.title)}（${m.category} · 难度 ${stars(m.difficulty)}）`
    })
    return `抽了 ${ids.length} 道题（不含答案）：\n${lines.join('\n')}\n\n一次只问一道，问完停下来等用户回答。用户回答后用 get_question 查看参考答案打分，再用 record_result 记录。`
  },
}

const profileTool: McpTool<McpContext> = {
  name: 'get_learning_profile',
  title: '学习情况',
  description: '查看用户的学习情况：各分类的掌握程度、AI 面试平均分、今天要复习的题数，以及最近答得差的题。用来判断用户的薄弱点。',
  inputSchema: { type: 'object', properties: {} },
  args: z.object({}).passthrough(),
  async run(ctx) {
    const p = await learningProfile(ctx.userId)
    if (p.note) return `用户${p.note}。今天要复习 ${p.dueToday} 道题。`
    const cats = p.categories!.map(
      (c) =>
        `- ${c.category}：共 ${c.total} 题，掌握 ${c.mastered}、模糊 ${c.fuzzy}、不会 ${c.weak}${c.interviewAvgScore !== null ? `，AI 面试平均 ${c.interviewAvgScore} 分` : ''}`,
    )
    const low = p.recentLowScores!.map((q) => `- [id ${q.questionId}] ${plain(q.title)}：${q.score} 分`)
    return [
      `今天要复习 ${p.dueToday} 道题。`,
      `各分类（薄弱的在前）：\n${cats.join('\n')}`,
      low.length ? `最近 AI 面试里答得差的题：\n${low.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  },
}

const dueTool: McpTool<McpContext> = {
  name: 'get_due_reviews',
  title: '今日复习',
  description: '列出今天到期该复习的题（按间隔重复算法安排，逾期最久的在前，按北京时间算"今天"）。',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 30, description: '最多列几道，默认 10' } },
  },
  args: z.object({ limit: z.number().int().min(1).max(30).default(10) }),
  async run(ctx, { limit }) {
    const [cards, meta] = await Promise.all([dueCards(ctx.userId, BEIJING, limit), questionMeta()])
    const rows = cards.filter((c) => meta.has(c.questionId))
    if (!rows.length) return '今天没有要复习的题。可以用 pick_quiz_questions 抽几道新题练练。'
    const today = day(new Date())
    const lines = rows.map((c) => {
      const m = meta.get(c.questionId)!
      const due = day(c.due)
      return `- [id ${c.questionId}] ${plain(m.title)}（${m.category}）· ${due < today ? `${due} 到期，已逾期` : '今天到期'}`
    })
    return `今天要复习 ${rows.length} 道题：\n${lines.join('\n')}`
  },
}

const recordTool: McpTool<McpContext> = {
  name: 'record_result',
  title: '记录答题结果',
  description:
    '用户回答完一道题后，记录 0～10 分的得分。会按间隔重复算法更新这道题的复习计划，7 分及以下还会把题标记为"模糊"或"不会"。只在用户真的回答了这道题之后调用。',
  inputSchema: {
    type: 'object',
    properties: {
      question_id: { type: 'integer', description: '题目 id' },
      score: { type: 'integer', minimum: 0, maximum: 10, description: '9～10 完整准确，7～8 主干正确，5～6 不完整，3～4 只答出零星要点，0～2 基本不会' },
    },
    required: ['question_id', 'score'],
  },
  write: true,
  args: z.object({ question_id: z.number().int().positive(), score: z.number().min(0).max(10) }),
  async run(ctx, { question_id, score }) {
    const meta = await questionOrThrow(question_id)
    const s = Math.round(score)
    const card = await reviewQuestion(ctx.userId, question_id, gradeFromScore(s), 'mcp')
    const status = statusFromScore(s)
    if (status) {
      const current = await getStudyRecord(ctx.userId, question_id)
      await saveStudyRecord(ctx.userId, question_id, { status, starred: current?.starred ?? false, note: current?.note ?? null })
    }
    return `已记录「${plain(meta.title)}」${s}/10 分，下次复习 ${day(card.due)}${status ? `，已标记为"${STUDY_STATUS_LABEL[status]}"` : ''}。`
  },
}

const QUIZ_FLOW = [
  '一次只问一道题，问完就停下来等我回答，不要替我回答，也不要提前透露答案。',
  '我回答后，调用 get_question 查看参考答案，按 0～10 分打分：先说我答对了什么，再指出遗漏或说错的地方，最后给一个面试时更好的说法。不要整段照搬参考答案。',
  '调用 record_result 记录得分（会写进我的复习计划；如果提示令牌是只读的，就跳过这一步）。',
]

const prompts = (site: string): McpPrompt[] => [
  {
    name: 'quiz',
    title: '考我几道题',
    description: '按方向从题库里抽题，一道一道考你，打分并写进复习计划',
    arguments: [
      { name: 'topic', description: '方向或分类，如 Redis、React；不填表示按薄弱点抽' },
      { name: 'count', description: '题数，默认 3' },
    ],
    build: ({ topic, count }) =>
      [
        `请用「${site}」的题库考我${topic ? `「${topic}」方向的题` : '几道题'}，一共 ${Number(count) || 3} 道。`,
        '',
        '流程：',
        `1. 先调用 get_learning_profile 看看我的薄弱点，再用 pick_quiz_questions 抽题${topic ? `（"${topic}"是分类名时传给 category，不是分类名时改用 find_questions 按关键词找题）` : ''}。`,
        ...QUIZ_FLOW.map((s, i) => `${i + 2}. ${s}`),
        `${QUIZ_FLOW.length + 2}. 全部问完后，总结我的整体表现和接下来该复习的知识点。`,
      ].join('\n'),
  },
  {
    name: 'review_today',
    title: '今日复习',
    description: '把今天到期该复习的题一道一道考你',
    arguments: [],
    build: () =>
      [
        `看看我在「${site}」今天该复习哪些题（get_due_reviews），然后从逾期最久的开始考我。没有到期的题时，用 pick_quiz_questions 抽 3 道薄弱的题。`,
        '',
        '流程：',
        ...QUIZ_FLOW.map((s, i) => `${i + 1}. ${s}`),
      ].join('\n'),
  },
  {
    name: 'explain',
    title: '用手册回答',
    description: '根据手册的内容回答一个技术或面试问题，并标出处',
    arguments: [{ name: 'question', description: '要问的问题', required: true }],
    build: ({ question }) =>
      [
        `根据「${site}」回答这个问题：${question}`,
        '',
        '先用 search_handbook 检索手册里的相关内容，再用自己的话回答：像面试时那样先给结论，再讲原理和取舍。用到手册内容的地方附上题目链接作为出处；手册里没有讲到的部分请明确说明。',
      ].join('\n'),
  },
]

export const MCP_TOOLS: McpTool<McpContext>[] = [searchHandbookTool, findQuestionsTool, getQuestionTool, pickQuizTool, profileTool, dueTool, recordTool]

export async function mcpServerDef(baseUrl: string): Promise<McpServerDef<McpContext>> {
  const site = String(useRuntimeConfig().public.siteName || '全栈面试手册')
  const total = (await getOutline()).reduce((n, p) => n + p.categories.reduce((m, c) => m + c.questions.length, 0), 0)
  return {
    info: { name: 'mianbook', title: site, version: '1.0.0' },
    instructions: [
      `「${site}」（${baseUrl}）的题库（${total} 道前端、后端、AI 应用开发面试题）和当前用户的学习记录。`,
      '- 回答这些方向的技术问题时，先用 search_handbook 检索手册，回答里附上题目链接作为出处。',
      '- 用户想练习时，用 pick_quiz_questions 抽题，一次问一道；用户回答后用 get_question 对照参考答案打分，再用 record_result 记录（会写进用户的复习计划）。',
      '- get_learning_profile 和 get_due_reviews 可以查看用户的薄弱点和今天该复习的题。',
    ].join('\n'),
    tools: MCP_TOOLS,
    prompts: prompts(site),
  }
}
