/**
 * 默写练习的题目文件 practice/<题目路径>.md（比如 practice/basics/handwriting/01-promise.md 对应 /basics/handwriting/01-promise）：
 *
 *   ---
 *   title: 手写 Promise.all     练习的标题，不写就用题目标题
 *   dom: true                   测试要用 document（npm run practice:check 在 Node 里跑不了，只在浏览器里验证）
 *   ---
 *   ## 要求       Markdown：要实现什么、函数签名、要注意的点
 *   ## 提示       可选，列表，一条一个，页面上一条一条展开
 *   ## 起始代码   一个 js 代码块：函数签名和空的函数体
 *   ## 测试       一个 js 代码块：test('名字', () => { expect(...).toBe(...) })，可以用 delay、fn
 *   ## 参考答案   一个 js 代码块：能通过全部测试的实现
 *
 * 写法和要求见 templates/practice-guide.md
 */
export interface PracticeSpec {
  title?: string
  dom: boolean
  /** 要求（Markdown） */
  task: string
  hints: string[]
  starter: string
  tests: string
  solution: string
}

const SECTIONS = { 要求: 'task', 提示: 'hints', 起始代码: 'starter', 测试: 'tests', 参考答案: 'solution' } as const

function codeBlock(section: string, name: string): string {
  const m = section.match(/```(?:js|javascript)\n([\s\S]*?)\n```/)
  if (!m) throw new Error(`"${name}"里要有一个 js 代码块`)
  return m[1]!
}

export function parsePracticeSpec(md: string): PracticeSpec {
  let body = md.replace(/\r\n/g, '\n')
  const meta: Record<string, string> = {}
  const front = body.match(/^---\n([\s\S]*?)\n---\n/)
  if (front) {
    for (const line of front[1]!.split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/)
      if (m) meta[m[1]!] = m[2]!.trim()
    }
    body = body.slice(front[0].length)
  }

  const parts: Partial<Record<(typeof SECTIONS)[keyof typeof SECTIONS], string>> = {}
  const headings = [...body.matchAll(/^## (.+)$/gm)]
  headings.forEach((h, i) => {
    const key = SECTIONS[h[1]!.trim() as keyof typeof SECTIONS]
    if (!key) throw new Error(`不认识的小节"${h[1]}"，只能是：${Object.keys(SECTIONS).join('、')}`)
    parts[key] = body.slice(h.index! + h[0].length, headings[i + 1]?.index ?? body.length).trim()
  })
  for (const name of ['要求', '起始代码', '测试', '参考答案'] as const) {
    if (!parts[SECTIONS[name]]) throw new Error(`缺少"## ${name}"小节`)
  }

  return {
    title: meta.title || undefined,
    dom: meta.dom === 'true',
    task: parts.task!,
    hints: (parts.hints ?? '')
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim()),
    starter: codeBlock(parts.starter!, '起始代码'),
    tests: codeBlock(parts.tests!, '测试'),
    solution: codeBlock(parts.solution!, '参考答案'),
  }
}
