import {
  boolean,
  customType,
  datetime,
  double,
  index,
  int,
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'
import { sql } from 'drizzle-orm'
import type { InterviewTurn, MockConfig, MockItem, StoredCard, TocItem } from '../../shared/types/handbook'

// 用 datetime 而不是 timestamp，避开 2038 年问题；更新时间由 Drizzle 在每次 update 时写入
const createdAt = () => datetime('created_at', { mode: 'date' }).notNull().default(sql`CURRENT_TIMESTAMP`)
const updatedAt = () =>
  datetime('updated_at', { mode: 'date' })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdate(() => new Date())

export const users = mysqlTable(
  'users',
  {
    id: int('id').autoincrement().primaryKey(),
    email: varchar('email', { length: 191 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: mysqlEnum('role', ['admin', 'user']).notNull().default('user'),
    /** 邮箱验证通过的时间；开启注册验证码之前注册的账号为空 */
    emailVerifiedAt: datetime('email_verified_at', { mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
)

/** 邮箱验证码：只存哈希；同时用来限制同一个邮箱、同一个 IP 的发送频率 */
export const emailCodes = mysqlTable(
  'email_codes',
  {
    id: int('id').autoincrement().primaryKey(),
    email: varchar('email', { length: 191 }).notNull(),
    /** register 注册 */
    purpose: varchar('purpose', { length: 16 }).notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    ip: varchar('ip', { length: 45 }),
    /** 输错的次数，超过上限后这个验证码作废 */
    attempts: tinyint('attempts').notNull().default(0),
    expiresAt: datetime('expires_at', { mode: 'date' }).notNull(),
    usedAt: datetime('used_at', { mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [index('email_codes_email_idx').on(t.email, t.createdAt), index('email_codes_ip_idx').on(t.ip, t.createdAt)],
)

/** 部分：全栈基础、LLM 与 Agent、AI 工程化…… */
export const parts = mysqlTable(
  'parts',
  {
    id: int('id').autoincrement().primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    title: varchar('title', { length: 64 }).notNull(),
    sort: int('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('parts_slug_unique').on(t.slug)],
)

export const categories = mysqlTable(
  'categories',
  {
    id: int('id').autoincrement().primaryKey(),
    partId: int('part_id')
      .notNull()
      .references(() => parts.id),
    slug: varchar('slug', { length: 64 }).notNull(),
    title: varchar('title', { length: 64 }).notNull(),
    sort: int('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('categories_part_slug_unique').on(t.partId, t.slug)],
)

export const questions = mysqlTable(
  'questions',
  {
    id: int('id').autoincrement().primaryKey(),
    categoryId: int('category_id')
      .notNull()
      .references(() => categories.id),
    slug: varchar('slug', { length: 128 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    difficulty: tinyint('difficulty').notNull().default(2),
    tags: json('tags').$type<string[]>().notNull(),
    /** 正文 Markdown，不含一级标题 */
    contentMd: mediumtext('content_md').notNull(),
    /** 保存时预先渲染好的 HTML，阅读时直接输出 */
    contentHtml: mediumtext('content_html').notNull(),
    /** 纯文本，用于搜索 */
    contentText: mediumtext('content_text').notNull(),
    toc: json('toc').$type<TocItem[]>().notNull(),
    sort: int('sort').notNull().default(0),
    status: mysqlEnum('status', ['draft', 'published']).notNull().default('published'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('questions_category_slug_unique').on(t.categoryId, t.slug),
    index('questions_category_sort_idx').on(t.categoryId, t.sort),
  ],
)

export const studyRecords = mysqlTable(
  'study_records',
  {
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: int('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    status: mysqlEnum('status', ['weak', 'fuzzy', 'mastered']),
    starred: boolean('starred').notNull().default(false),
    note: text('note'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questionId] })],
)

/** 整场模拟面试：按方向抽若干道题连续作答，每道题对应一条 interviews 记录 */
export const mockSessions = mysqlTable(
  'mock_sessions',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 128 }).notNull(),
    config: json('config').$type<MockConfig>().notNull(),
    items: json('items').$type<MockItem[]>().notNull(),
    currentIndex: tinyint('current_index').notNull().default(0),
    status: mysqlEnum('status', ['active', 'finished']).notNull().default('active'),
    /** 全部题目的平均分，结束时写入 */
    score: double('score'),
    /** AI 生成的面试总结（Markdown） */
    report: mediumtext('report'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: datetime('finished_at', { mode: 'date' }),
  },
  (t) => [index('mock_sessions_user_created_idx').on(t.userId, t.createdAt)],
)

/** AI 模拟面试：一次面试最多 3 轮，每轮的回答和点评存在 turns 里 */
export const interviews = mysqlTable(
  'interviews',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: int('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    turns: json('turns').$type<InterviewTurn[]>().notNull(),
    rounds: tinyint('rounds').notNull().default(0),
    /** 最近一轮的得分 */
    score: tinyint('score'),
    /** 属于哪一场整场模拟面试；单题面试为空。删除那场面试时保留这条记录 */
    sessionId: int('session_id').references(() => mockSessions.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('interviews_user_question_idx').on(t.userId, t.questionId)],
)

/** 每次调用大模型记一条，用于按天限流和统计用量 */
export const aiCalls = mysqlTable(
  'ai_calls',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    promptTokens: int('prompt_tokens'),
    completionTokens: int('completion_tokens'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_calls_user_created_idx').on(t.userId, t.createdAt)],
)

/** 间隔重复：每个用户每道题一张卡片，记录 FSRS 算法的记忆状态和下次复习时间 */
export const reviewCards = mysqlTable(
  'review_cards',
  {
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: int('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    due: datetime('due', { mode: 'date' }).notNull(),
    stability: double('stability').notNull(),
    difficulty: double('difficulty').notNull(),
    elapsedDays: int('elapsed_days').notNull().default(0),
    scheduledDays: int('scheduled_days').notNull().default(0),
    learningSteps: int('learning_steps').notNull().default(0),
    reps: int('reps').notNull().default(0),
    lapses: int('lapses').notNull().default(0),
    /** 0 新卡片、1 学习中、2 复习中、3 重新学习 */
    state: tinyint('state').notNull().default(0),
    lastReview: datetime('last_review', { mode: 'date' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questionId] }), index('review_cards_user_due_idx').on(t.userId, t.due)],
)

/** 每次复习评分记一条，用于统计每天复习量、连续天数 */
export const reviewLogs = mysqlTable(
  'review_logs',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: int('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    /** 1 不会、2 模糊、3 会了、4 很熟 */
    rating: tinyint('rating').notNull(),
    /** review 复习页、page 题目页手动标记、interview 单题 AI 面试、mock 整场模拟面试 */
    source: mysqlEnum('source', ['review', 'page', 'interview', 'mock']).notNull(),
    /** 评分前的卡片；在题目页上短时间内改主意时，用它撤回上一次评分 */
    prevCard: json('prev_card').$type<StoredCard | null>(),
    createdAt: createdAt(),
  },
  (t) => [index('review_logs_user_created_idx').on(t.userId, t.createdAt)],
)

/**
 * 学习行为事件，用于学习周报。只记已有表里没有的：阅读时长、自测时查看答案、语音作答。
 * 面试、模拟面试、复习评分已经各有记录，不在这里重复。不记录任何回答内容
 */
export const events = mysqlTable(
  'events',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** read 阅读一道题、reveal 自测模式里查看答案、voice 用语音作答 */
    type: varchar('type', { length: 16 }).notNull(),
    questionId: int('question_id').references(() => questions.id, { onDelete: 'cascade' }),
    /** read、voice 是秒数 */
    value: int('value'),
    createdAt: createdAt(),
  },
  (t) => [index('events_user_created_idx').on(t.userId, t.createdAt)],
)

/** 站点设置：后台可以在线修改的配置（键值对），比如 AI 的模型、次数和价格。API Key 仍然只放 .env */
export const settings = mysqlTable('settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: json('value').notNull(),
  updatedAt: updatedAt(),
})

/** 题目的历史版本：后台每次保存前，把改动前的内容存一份，可以对比和恢复 */
export const questionVersions = mysqlTable(
  'question_versions',
  {
    id: int('id').autoincrement().primaryKey(),
    questionId: int('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    difficulty: tinyint('difficulty').notNull(),
    tags: json('tags').$type<string[]>().notNull(),
    status: mysqlEnum('status', ['draft', 'published']).notNull(),
    contentMd: mediumtext('content_md').notNull(),
    /** 谁做的这次修改（被覆盖掉的是这个版本） */
    editorId: int('editor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('question_versions_question_idx').on(t.questionId, t.createdAt)],
)

/** 向量用二进制存 Float32 数组：1024 维 4KB，比 JSON 小一半多，读出来也不用解析 */
const vectorBlob = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'blob' })

/** 问手册（RAG）的检索索引：每道已发布的题按小节切成几块，块的向量由服务启动和题目变动时自动生成 */
export const questionChunks = mysqlTable(
  'question_chunks',
  {
    id: int('id').autoincrement().primaryKey(),
    questionId: int('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    ord: int('ord').notNull(),
    heading: varchar('heading', { length: 255 }).notNull(),
    text: text('text').notNull(),
    /** 送去生成向量的文本（题目 + 小节 + 正文）的 SHA-256；内容没变时复用旧向量，不重复花钱 */
    hash: varchar('hash', { length: 64 }).notNull(),
    embedding: vectorBlob('embedding'),
    /** 生成向量用的模型；换了模型要重新生成 */
    embedModel: varchar('embed_model', { length: 128 }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('question_chunks_question_ord_unique').on(t.questionId, t.ord)],
)
