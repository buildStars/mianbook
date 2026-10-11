import fs from 'node:fs'
import path from 'node:path'
import { asc, eq } from 'drizzle-orm'

/**
 * 后台修改题目和目录时，把改动写回 content/ 下的 Markdown 和 outline.json，
 * 让文件和数据库保持一致（之后 db:import 不会冲掉后台的修改，修改也能进 git）。
 * 部署环境里没有 content/ 目录时不写，数据库就是唯一的数据来源
 */

export interface SyncResult {
  /** 是否写回了文件；没有 content 目录时为 false 且没有 error */
  synced: boolean
  error?: string
}

/** content 目录：默认是启动目录下的 content/，可以用 NUXT_CONTENT_DIR 指定 */
export function contentRoot(): string | null {
  const configured = String(useRuntimeConfig().contentDir || '')
  const dir = configured ? path.resolve(configured) : path.resolve(process.cwd(), 'content')
  return fs.existsSync(path.join(dir, 'outline.json')) ? dir : null
}

export interface QuestionLocation {
  /** 相对 content 目录的文件夹，如 basics/javascript */
  folder: string
  slug: string
}

/** 题目在 content 里的位置（部分/分类/slug） */
export async function questionFileLocation(id: number): Promise<QuestionLocation | null> {
  const [row] = await useDb()
    .select({ slug: tables.questions.slug, catSlug: tables.categories.slug, partSlug: tables.parts.slug })
    .from(tables.questions)
    .innerJoin(tables.categories, eq(tables.categories.id, tables.questions.categoryId))
    .innerJoin(tables.parts, eq(tables.parts.id, tables.categories.partId))
    .where(eq(tables.questions.id, id))
  return row ? { folder: `${row.partSlug}/${row.catSlug}`, slug: row.slug } : null
}

async function guard(fn: (root: string) => Promise<void> | void): Promise<SyncResult> {
  const root = contentRoot()
  if (!root) return { synced: false }
  try {
    await fn(root)
    return { synced: true }
  } catch (error) {
    console.error('[content-sync]', error)
    return { synced: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 把数据库里的一道题写成 Markdown 文件；previous 是改动前的位置，换了分类或 slug 时删掉旧文件 */
export function writeQuestionFile(id: number, previous?: QuestionLocation | null): Promise<SyncResult> {
  return guard(async (root) => {
    const [q] = await useDb().select().from(tables.questions).where(eq(tables.questions.id, id))
    const loc = await questionFileLocation(id)
    if (!q || !loc) return
    const dir = path.join(root, loc.folder)
    fs.mkdirSync(dir, { recursive: true })

    // 和导入一致：文件名排第几，默认 sort 就是第几个 × 10；不一样时才把 sort 写进 frontmatter
    const names = new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.md')))
    if (previous && previous.folder === loc.folder) names.delete(`${previous.slug}.md`)
    names.add(`${loc.slug}.md`)
    const index = [...names].sort(byFileName).indexOf(`${loc.slug}.md`)

    const text = serializeQuestionFile({
      title: q.title,
      difficulty: q.difficulty,
      tags: q.tags,
      status: q.status,
      sort: q.sort === defaultSort(index) ? undefined : q.sort,
      content: q.contentMd,
    })
    fs.writeFileSync(path.join(dir, `${loc.slug}.md`), text)
    if (previous && (previous.folder !== loc.folder || previous.slug !== loc.slug)) {
      fs.rmSync(path.join(root, previous.folder, `${previous.slug}.md`), { force: true })
    }
  })
}

export function removeQuestionFile(loc: QuestionLocation | null): Promise<SyncResult> {
  return guard((root) => {
    if (loc) fs.rmSync(path.join(root, loc.folder, `${loc.slug}.md`), { force: true })
  })
}

/** 按数据库重写 outline.json；moves 是改了 slug 或所属部分的文件夹，先挪过去 */
export function writeOutlineFile(moves: { from: string; to: string }[] = []): Promise<SyncResult> {
  return guard(async (root) => {
    for (const { from, to } of moves) {
      if (from === to) continue
      const src = path.join(root, from)
      if (!fs.existsSync(src)) continue
      fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true })
      fs.renameSync(src, path.join(root, to))
    }
    const db = useDb()
    const [parts, cats] = await Promise.all([
      db.select().from(tables.parts).orderBy(asc(tables.parts.sort), asc(tables.parts.id)),
      db.select().from(tables.categories).orderBy(asc(tables.categories.sort), asc(tables.categories.id)),
    ])
    const outline = parts.map((p) => ({
      slug: p.slug,
      title: p.title,
      categories: cats.filter((c) => c.partId === p.id).map((c) => ({ slug: c.slug, title: c.title })),
    }))
    // 和手写的 outline.json 保持同样的排版：分类一行一个
    const json = JSON.stringify(outline, null, 2).replace(
      /\{\n\s+"slug": ("[^"]+"),\n\s+"title": ("[^"]+")\n\s+\}/g,
      '{ "slug": $1, "title": $2 }',
    )
    fs.writeFileSync(path.join(root, 'outline.json'), `${json}\n`)
  })
}

/** 分类在 content 里的文件夹 */
export async function categoryFolder(categoryId: number): Promise<string | null> {
  const [row] = await useDb()
    .select({ cat: tables.categories.slug, part: tables.parts.slug })
    .from(tables.categories)
    .innerJoin(tables.parts, eq(tables.parts.id, tables.categories.partId))
    .where(eq(tables.categories.id, categoryId))
  return row ? `${row.part}/${row.cat}` : null
}
