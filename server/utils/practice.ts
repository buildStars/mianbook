import type { PracticeDetail, PracticeSummary } from '#shared/types/practice'
import type { PracticeSpec } from '#shared/utils/practice-spec'
import { parsePracticeSpec } from '#shared/utils/practice-spec'

/**
 * 默写练习：题目文件在 practice/ 下（打包成服务端资源 assets:practice），路径和题目一一对应。
 * 解析结果缓存在内存里；开发时每次重新读，改了文件刷新就能看到
 */
let cache: Promise<Map<string, PracticeSpec>> | null = null

function loadSpecs(): Promise<Map<string, PracticeSpec>> {
  const load = async () => {
    const storage = useStorage('assets:practice')
    const specs = new Map<string, PracticeSpec>()
    for (const key of await storage.getKeys()) {
      if (!key.endsWith('.md')) continue
      // 存储的键用冒号分隔：basics:handwriting:13-promisify.md
      const path = `/${key.replace(/\.md$/, '').split(':').join('/')}`
      try {
        specs.set(path, parsePracticeSpec(String(await storage.getItem(key))))
      } catch (error) {
        console.error(`[practice] ${key} 格式错误`, error)
      }
    }
    return specs
  }
  if (import.meta.dev) return load()
  cache ??= load()
  return cache
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 提示是一行文字，只支持 `代码` */
const renderHint = (hint: string) => escapeHtml(hint).replace(/`([^`]+)`/g, '<code>$1</code>')

/** 全部练习，按目录顺序；题目没有发布的不列 */
export async function listPractice(): Promise<PracticeSummary[]> {
  const specs = await loadSpecs()
  const outline = await getOutline()
  const list: PracticeSummary[] = []
  for (const part of outline) {
    for (const cat of part.categories) {
      for (const q of cat.questions) {
        const spec = specs.get(q.path)
        if (!spec) continue
        list.push({
          path: q.path,
          title: spec.title ?? plainQuestionTitle(q.title),
          questionTitle: q.title,
          questionId: q.id,
          num: q.num,
          difficulty: q.difficulty,
          category: { slug: cat.slug, title: cat.title },
        })
      }
    }
  }
  return list
}

/** 练习的原始内容（AI 点评要用 Markdown 原文的要求） */
export async function practiceSpec(path: string): Promise<PracticeSpec | null> {
  return (await loadSpecs()).get(path) ?? null
}

export async function hasPractice(path: string): Promise<boolean> {
  return (await loadSpecs()).has(path)
}

export async function getPractice(path: string): Promise<PracticeDetail | null> {
  const spec = (await loadSpecs()).get(path)
  if (!spec) return null
  const list = await listPractice()
  const index = list.findIndex((p) => p.path === path)
  if (index === -1) return null
  const item = list[index]!
  const link = (p: PracticeSummary | undefined) => (p ? { title: p.title, path: p.path } : null)
  return {
    ...item,
    taskHtml: (await renderMarkdown(spec.task)).html,
    hints: spec.hints.map(renderHint),
    starter: spec.starter,
    tests: spec.tests,
    solution: spec.solution,
    dom: spec.dom,
    prev: link(list[index - 1]),
    next: link(list[index + 1]),
  }
}

const plainQuestionTitle = (title: string) => title.replace(/`/g, '')
