import {
  boolean,
  datetime,
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
import type { InterviewTurn, TocItem } from '../../shared/types/handbook'

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
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
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
