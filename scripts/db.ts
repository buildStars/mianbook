// 数据库脚本：tsx scripts/db.ts <migrate|import|export|rerender> [目录] [--force]
//   migrate        执行 server/db/migrations 下的迁移
//   import [dir]   把 Markdown 题目导入数据库（默认读 content/，没有则读 docs/），按 slug 更新；
//                  数据库里的版本比文件新且内容不同时（比如在后台改过但没写回文件）跳过并提示，加 --force 强制覆盖
//   export [dir]   把数据库里的题目导出为 Markdown（默认写到 content/），用于备份和版本管理
//   rerender       修改了 Markdown 渲染规则后，用库里的 Markdown 重新生成所有题目的 HTML
import fs from 'node:fs'
import path from 'node:path'
import { and, asc, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { createDb, tables } from '../server/utils/db'
import { renderMarkdown } from '../server/utils/markdown'
import { byFileName, defaultSort, parseQuestionFile, serializeQuestionFile } from '../server/utils/content-file'

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

function contentDir(arg?: string) {
  if (arg) return path.resolve(root, arg)
  const preferred = path.join(root, 'content')
  return fs.existsSync(preferred) ? preferred : path.join(root, 'docs')
}

async function runMigrate() {
  await migrate(db, { migrationsFolder: path.join(root, 'server/db/migrations') })
  console.log('迁移完成')
}

async function runImport(dir: string, force: boolean) {
  const outline: OutlineEntry[] = JSON.parse(fs.readFileSync(path.join(dir, 'outline.json'), 'utf-8'))
  let imported = 0
  let unchanged = 0
  const conflicts: string[] = []

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
      const files = fs.readdirSync(folder).filter((f) => f.endsWith('.md')).sort(byFileName)

      for (const [index, file] of files.entries()) {
        const filePath = path.join(folder, file)
        const q = parseQuestionFile(fs.readFileSync(filePath, 'utf-8'), file)
        const slug = file.replace(/\.md$/, '')
        const sort = q.sort ?? defaultSort(index)
        const [existing] = await db
          .select()
          .from(tables.questions)
          .where(and(eq(tables.questions.categoryId, catRow!.id), eq(tables.questions.slug, slug)))
        if (existing) {
          const same =
            existing.title === q.title &&
            existing.contentMd.trim() === q.content.trim() &&
            existing.difficulty === q.difficulty &&
            existing.status === q.status &&
            existing.sort === sort &&
            JSON.stringify(existing.tags) === JSON.stringify(q.tags)
          if (same) {
            unchanged++
            continue
          }
          // 数据库比文件新：多半是在后台改过但文件没同步，直接覆盖会丢掉后台的修改
          if (!force && existing.updatedAt.getTime() > fs.statSync(filePath).mtimeMs + 2000) {
            conflicts.push(path.relative(root, filePath))
            continue
          }
        }
        const rendered = await renderMarkdown(q.content)
        const values = {
          title: q.title,
          difficulty: q.difficulty,
          tags: q.tags,
          contentMd: q.content,
          contentHtml: rendered.html,
          contentText: rendered.text,
          toc: rendered.toc,
          sort,
          status: q.status,
        }
        await db
          .insert(tables.questions)
          .values({ categoryId: catRow!.id, slug, ...values })
          .onDuplicateKeyUpdate({ set: values })
        imported++
      }
    }
  }
  console.log(`导入完成：更新 ${imported} 道，${unchanged} 道没有变化（来源：${path.relative(root, dir) || '.'}）`)
  if (conflicts.length) {
    console.warn(`\n有 ${conflicts.length} 道题数据库里的版本比文件新，已跳过，没有覆盖：`)
    for (const f of conflicts) console.warn(`  - ${f}`)
    console.warn('先用 npm run db:export 把数据库导出到文件、确认差异；确定要用文件覆盖时加 --force')
    process.exitCode = 2
  }
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
      const ordered = rows.map((q) => `${q.slug}.md`).sort(byFileName)
      for (const q of rows) {
        const index = ordered.indexOf(`${q.slug}.md`)
        const text = serializeQuestionFile({
          title: q.title,
          difficulty: q.difficulty,
          tags: q.tags,
          status: q.status,
          sort: q.sort === defaultSort(index) ? undefined : q.sort,
          content: q.contentMd,
        })
        fs.writeFileSync(path.join(folder, `${q.slug}.md`), text)
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

const args = process.argv.slice(2)
const force = args.includes('--force')
const [command, dirArg] = args.filter((a) => !a.startsWith('--'))
try {
  if (command === 'migrate') await runMigrate()
  else if (command === 'import') await runImport(contentDir(dirArg), force)
  else if (command === 'export') await runExport(dirArg ? path.resolve(root, dirArg) : path.join(root, 'content'))
  else if (command === 'rerender') await runRerender()
  else {
    console.log('用法：tsx scripts/db.ts <migrate|import|export|rerender> [目录] [--force]')
    process.exitCode = 1
  }
} finally {
  await db.$client.end()
}
