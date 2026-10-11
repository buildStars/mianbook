// 数据库脚本：tsx scripts/db.ts <migrate|import|export|rerender> [目录]
//   migrate        执行 server/db/migrations 下的迁移
//   import [dir]   把 Markdown 题目导入数据库（默认读 content/，没有则读 docs/），按 slug 覆盖更新
//   export [dir]   把数据库里的题目导出为 Markdown（默认写到 content/），用于备份和版本管理
//   rerender       修改了 Markdown 渲染规则后，用库里的 Markdown 重新生成所有题目的 HTML
import fs from 'node:fs'
import path from 'node:path'
import { and, asc, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { parse as parseYaml } from 'yaml'
import { createDb, tables } from '../server/utils/db'
import { renderMarkdown } from '../server/utils/markdown'

const root = path.resolve(import.meta.dirname, '..')
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {
  // 没有 .env 时使用已有的环境变量
}

const url = process.env.NUXT_DATABASE_URL
if (!url) {
  console.error('没有配置 NUXT_DATABASE_URL，请先运行 npm run db:init')
  process.exit(1)
}
const db = createDb(url)

interface OutlineEntry {
  slug: string
  title: string
  categories: { slug: string; title: string }[]
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

function contentDir(arg?: string) {
  if (arg) return path.resolve(root, arg)
  const preferred = path.join(root, 'content')
  return fs.existsSync(preferred) ? preferred : path.join(root, 'docs')
}

/** 拆出 frontmatter、一级标题和正文 */
function parseQuestion(src: string, file: string) {
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
    status: data.status === 'draft' ? ('draft' as const) : ('published' as const),
    sort: typeof data.sort === 'number' ? data.sort : undefined,
    content: `${content}\n`,
  }
}

async function runMigrate() {
  await migrate(db, { migrationsFolder: path.join(root, 'server/db/migrations') })
  console.log('迁移完成')
}

async function runImport(dir: string) {
  const outline: OutlineEntry[] = JSON.parse(fs.readFileSync(path.join(dir, 'outline.json'), 'utf-8'))
  let imported = 0

  for (const [partIndex, part] of outline.entries()) {
    await db
      .insert(tables.parts)
      .values({ slug: part.slug, title: part.title, sort: partIndex })
      .onDuplicateKeyUpdate({ set: { title: part.title, sort: partIndex } })
    const [partRow] = await db.select().from(tables.parts).where(eq(tables.parts.slug, part.slug))

    for (const [catIndex, cat] of part.categories.entries()) {
      await db
        .insert(tables.categories)
        .values({ partId: partRow!.id, slug: cat.slug, title: cat.title, sort: catIndex })
        .onDuplicateKeyUpdate({ set: { title: cat.title, sort: catIndex } })
      const [catRow] = await db
        .select()
        .from(tables.categories)
        .where(and(eq(tables.categories.partId, partRow!.id), eq(tables.categories.slug, cat.slug)))

      const folder = path.join(dir, part.slug, cat.slug)
      if (!fs.existsSync(folder)) continue
      const files = fs.readdirSync(folder).filter((f) => f.endsWith('.md')).sort(byName)

      for (const [index, file] of files.entries()) {
        const q = parseQuestion(fs.readFileSync(path.join(folder, file), 'utf-8'), file)
        const rendered = await renderMarkdown(q.content)
        const values = {
          title: q.title,
          difficulty: q.difficulty,
          tags: q.tags,
          contentMd: q.content,
          contentHtml: rendered.html,
          contentText: rendered.text,
          toc: rendered.toc,
          sort: q.sort ?? (index + 1) * 10,
          status: q.status,
        }
        await db
          .insert(tables.questions)
          .values({ categoryId: catRow!.id, slug: file.replace(/\.md$/, ''), ...values })
          .onDuplicateKeyUpdate({ set: values })
        imported++
      }
    }
  }
  console.log(`导入完成：${imported} 道题（来源：${path.relative(root, dir) || '.'}）`)
}

async function runExport(dir: string) {
  const parts = await db.select().from(tables.parts).orderBy(asc(tables.parts.sort))
  const outline: OutlineEntry[] = []
  let exported = 0

  for (const part of parts) {
    const cats = await db
      .select()
      .from(tables.categories)
      .where(eq(tables.categories.partId, part.id))
      .orderBy(asc(tables.categories.sort))
    outline.push({ slug: part.slug, title: part.title, categories: cats.map((c) => ({ slug: c.slug, title: c.title })) })

    for (const cat of cats) {
      const rows = await db
        .select()
        .from(tables.questions)
        .where(eq(tables.questions.categoryId, cat.id))
        .orderBy(asc(tables.questions.sort))
      if (!rows.length) continue
      const folder = path.join(dir, part.slug, cat.slug)
      fs.mkdirSync(folder, { recursive: true })
      for (const q of rows) {
        const front = [
          '---',
          `difficulty: ${q.difficulty}`,
          `tags: [${q.tags.join(', ')}]`,
          `sort: ${q.sort}`,
          ...(q.status === 'draft' ? ['status: draft'] : []),
          '---',
        ].join('\n')
        fs.writeFileSync(path.join(folder, `${q.slug}.md`), `${front}\n\n# ${q.title}\n\n${q.contentMd.trim()}\n`)
        exported++
      }
    }
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'outline.json'), `${JSON.stringify(outline, null, 2)}\n`)
  console.log(`导出完成：${exported} 道题 → ${path.relative(root, dir)}`)
}

async function runRerender() {
  const rows = await db.select({ id: tables.questions.id, contentMd: tables.questions.contentMd }).from(tables.questions)
  for (const row of rows) {
    const rendered = await renderMarkdown(row.contentMd)
    await db
      .update(tables.questions)
      // 内容没变，保留原来的更新时间
      .set({ contentHtml: rendered.html, contentText: rendered.text, toc: rendered.toc, updatedAt: sql`updated_at` })
      .where(eq(tables.questions.id, row.id))
  }
  console.log(`重新渲染完成：${rows.length} 道题`)
}

const [command, dirArg] = process.argv.slice(2)
try {
  if (command === 'migrate') await runMigrate()
  else if (command === 'import') await runImport(contentDir(dirArg))
  else if (command === 'export') await runExport(dirArg ? path.resolve(root, dirArg) : path.join(root, 'content'))
  else if (command === 'rerender') await runRerender()
  else {
    console.log('用法：tsx scripts/db.ts <migrate|import|export|rerender> [目录]')
    process.exitCode = 1
  }
} finally {
  await db.$client.end()
}
