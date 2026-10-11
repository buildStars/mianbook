import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionFile, serializeQuestionFile } from '../../server/utils/content-file'

const root = path.resolve(import.meta.dirname, '../../content')
const files = fs
  .readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.md'))
  .map((f) => path.join(root, f))

describe('题目文件的解析和序列化', () => {
  it('content/ 里每个文件解析后再序列化，和原文件一字不差（后台写回不会产生多余改动）', () => {
    const changed = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8')
      return serializeQuestionFile(parseQuestionFile(src, f)) !== src
    })
    expect(files.length).toBeGreaterThan(300)
    expect(changed.map((f) => path.relative(root, f))).toEqual([])
  })

  it('草稿和自定义排序写进 frontmatter', () => {
    const src = serializeQuestionFile({ title: '题目', difficulty: 3, tags: ['高频'], status: 'draft', sort: 5, content: '正文\n' })
    expect(src).toBe('---\ndifficulty: 3\ntags: [高频]\nsort: 5\nstatus: draft\n---\n\n# 题目\n\n正文\n')
    expect(parseQuestionFile(src, 'x.md')).toEqual({ title: '题目', difficulty: 3, tags: ['高频'], status: 'draft', sort: 5, content: '正文\n' })
  })

  it('缺少一级标题时报错', () => {
    expect(() => parseQuestionFile('---\ndifficulty: 2\n---\n正文', 'bad.md')).toThrow('缺少一级标题')
  })
})
