import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, inject, it } from 'vitest'
import { Client, db } from './helpers'

const root = path.resolve(import.meta.dirname, '../..')
const contentDir = () => inject('contentDir')
const file = (...p: string[]) => path.join(contentDir(), ...p)

/** 注册一个用户并直接在库里提升为管理员 */
async function admin() {
  const c = new Client()
  const u = await c.register('admin')
  await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [u.id])
  return c
}

async function categoryId(part: string, slug: string) {
  const [[row]] = await db().query<any[]>(
    'SELECT c.id FROM categories c JOIN parts p ON p.id = c.part_id WHERE p.slug = ? AND c.slug = ?',
    [part, slug],
  )
  return row.id as number
}

const body = (patch: Record<string, unknown>) => ({
  slug: '99-sync-test',
  title: '后台同步测试题？',
  difficulty: 2,
  tags: ['实践'],
  contentMd: '::: tip 一句话回答\n测试内容。\n:::\n\n## 详细解析\n\n正文。\n',
  status: 'published',
  ...patch,
})

describe('后台改题写回 content 目录', () => {
  it('新建、修改、改 slug、换分类、删除都同步到 Markdown 文件', async () => {
    const c = await admin()
    const js = await categoryId('basics', 'javascript')
    const ts = await categoryId('basics', 'typescript')

    const created = await c.json('/api/admin/questions', { body: body({ categoryId: js }) })
    expect(created.status).toBe(200)
    expect(created.data.sync).toEqual({ synced: true })
    const first = fs.readFileSync(file('basics', 'javascript', '99-sync-test.md'), 'utf8')
    expect(first).toBe('---\ndifficulty: 2\ntags: [实践]\n---\n\n# 后台同步测试题？\n\n::: tip 一句话回答\n测试内容。\n:::\n\n## 详细解析\n\n正文。\n')

    const id = created.data.id
    // 改标题、改成草稿、调整难度
    const updated = await c.json(`/api/admin/questions/${id}`, { method: 'PUT', body: body({ categoryId: js, title: '改过的标题？', status: 'draft', difficulty: 3 }) })
    expect(updated.data).toMatchObject({ sync: { synced: true } })
    const second = fs.readFileSync(file('basics', 'javascript', '99-sync-test.md'), 'utf8')
    expect(second).toContain('# 改过的标题？')
    expect(second).toContain('status: draft')
    expect(second).toContain('difficulty: 3')

    // 改 slug 并换到 TypeScript 分类：旧文件删掉，新位置出现
    await c.json(`/api/admin/questions/${id}`, { method: 'PUT', body: body({ categoryId: ts, slug: '98-moved', title: '搬家了？' }) })
    expect(fs.existsSync(file('basics', 'javascript', '99-sync-test.md'))).toBe(false)
    expect(fs.readFileSync(file('basics', 'typescript', '98-moved.md'), 'utf8')).toContain('# 搬家了？')

    await c.request(`/api/admin/questions/${id}`, { method: 'DELETE' })
    expect(fs.existsSync(file('basics', 'typescript', '98-moved.md'))).toBe(false)
  })

  it('改分类的 slug 会移动文件夹并更新 outline.json，再改回来', async () => {
    const c = await admin()
    const id = await categoryId('basics', 'design-pattern')
    const [[cat]] = await db().query<any[]>('SELECT part_id, title, sort FROM categories WHERE id = ?', [id])
    const count = fs.readdirSync(file('basics', 'design-pattern')).length

    const res = await c.json(`/api/admin/categories/${id}`, { method: 'PUT', body: { partId: cat.part_id, slug: 'patterns', title: cat.title, sort: cat.sort } })
    expect(res.data.sync).toEqual({ synced: true })
    expect(fs.existsSync(file('basics', 'design-pattern'))).toBe(false)
    expect(fs.readdirSync(file('basics', 'patterns'))).toHaveLength(count)
    const outline = JSON.parse(fs.readFileSync(file('outline.json'), 'utf8'))
    expect(outline[0].categories.some((x: any) => x.slug === 'patterns')).toBe(true)

    await c.json(`/api/admin/categories/${id}`, { method: 'PUT', body: { partId: cat.part_id, slug: 'design-pattern', title: cat.title, sort: cat.sort } })
    expect(fs.readdirSync(file('basics', 'design-pattern'))).toHaveLength(count)
    // 写回的 outline.json 和项目里的一致（排版也一样）
    expect(fs.readFileSync(file('outline.json'), 'utf8')).toBe(fs.readFileSync(path.join(root, 'content/outline.json'), 'utf8'))
  })

  it('普通用户不能改题', async () => {
    const c = new Client()
    await c.register('nobody')
    const res = await c.request('/api/admin/questions', { body: body({ categoryId: 1 }) })
    expect(res.status).toBe(403)
  })
})

describe('导入时不覆盖后台更新过的题', () => {
  it('数据库比文件新且内容不同：跳过并提示；加 --force 才覆盖', async () => {
    const [[q]] = await db().query<any[]>(
      "SELECT q.id, q.content_md FROM questions q JOIN categories c ON c.id = q.category_id WHERE c.slug = 'vue' AND q.slug = '01-reactivity'",
    )
    // 模拟"在后台改了但文件没同步"：只改数据库，并把更新时间设到未来
    await db().query("UPDATE questions SET content_md = CONCAT(content_md, '\\n后台加的一句。\\n'), updated_at = NOW() + INTERVAL 1 HOUR WHERE id = ?", [q.id])

    const run = (...extra: string[]) => {
      try {
        const out = execFileSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'scripts/db.ts', 'import', contentDir(), ...extra], {
          cwd: root,
          env: { ...process.env, NUXT_DATABASE_URL: inject('dbUrl') },
          stdio: 'pipe',
        })
        return { code: 0, out: out.toString() }
      } catch (error: any) {
        return { code: error.status as number, out: `${error.stdout}${error.stderr}` }
      }
    }

    const skipped = run()
    expect(skipped.code).toBe(2)
    expect(skipped.out).toContain('01-reactivity.md')
    const [[kept]] = await db().query<any[]>('SELECT content_md FROM questions WHERE id = ?', [q.id])
    expect(kept.content_md).toContain('后台加的一句')

    const forced = run('--force')
    expect(forced.code).toBe(0)
    const [[restored]] = await db().query<any[]>('SELECT content_md FROM questions WHERE id = ?', [q.id])
    expect(restored.content_md.trim()).toBe(q.content_md.trim())
  })
})
