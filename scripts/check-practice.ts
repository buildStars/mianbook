// 检查默写练习：tsx scripts/check-practice.ts [题目路径或文件名的一部分 ...]（npm run practice:check）
// 每个练习：格式能解析、对应的题目存在、参考答案能通过全部测试、起始代码不能全部通过、至少 4 条测试。
// dom: true 的练习要用 document，这里只检查格式，运行留给浏览器。有问题时退出码为 1
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { preparePractice } from '../shared/utils/code-prep'
import { parsePracticeSpec } from '../shared/utils/practice-spec'
import { FORMAT_SOURCE, HARNESS_SOURCE } from '../server/utils/code-runner-page'

const root = path.resolve(import.meta.dirname, '..')
export const PRACTICE_DIR = path.join(root, 'practice')

export interface TestResult {
  name: string
  ok: boolean
  error: { message: string } | null
}

const formatValue = new Function(`${FORMAT_SOURCE}; return formatValue`)() as (v: unknown, top: boolean) => string
const createPractice = new Function(`${HARNESS_SOURCE}; return createPractice`)() as (
  format: typeof formatValue,
  report: (r: any) => void,
  lineOf: () => null,
) => { run: () => Promise<unknown> }
const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<void>

/** 在 Node 里跑一份代码和测试，返回每条用例的结果；代码本身出错（语法、顶层异常）时返回 error */
export async function runPractice(code: string, tests: string): Promise<{ results: TestResult[]; error?: string }> {
  const prepared = preparePractice(code, tests)
  if (!prepared.ok) return { results: [], error: prepared.message }
  const results: TestResult[] = []
  const practice = createPractice(formatValue, (r) => !r.done && results.push(r), () => null)
  let loops = 0
  const guard = () => {
    if (++loops > 10_000_000) throw new RangeError('循环超过 1000 万次')
  }
  // 测试里没接住的异步异常（比如定时器里抛错）记成错误，不让进程崩掉
  const uncaught: string[] = []
  const onError = (e: unknown) => uncaught.push(String(e))
  process.on('uncaughtException', onError)
  process.on('unhandledRejection', onError)
  try {
    await new AsyncFunction('__practice', '__done', '__loopGuard', prepared.source)(practice, () => {}, guard)
  } catch (error) {
    return { results, error: `代码出错：${error}` }
  } finally {
    // 等一下再摘掉监听，接住用例结束后才冒出来的异常
    await new Promise((r) => setTimeout(r, 50))
    process.off('uncaughtException', onError)
    process.off('unhandledRejection', onError)
  }
  return { results, error: uncaught.length ? `没有接住的异常：${uncaught.join('；')}` : undefined }
}

export function practiceFiles(dir = PRACTICE_DIR): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return practiceFiles(full)
    return e.name.endsWith('.md') ? [full] : []
  })
}

/** 检查一个练习文件，返回问题列表（空数组表示没问题） */
export async function checkPracticeFile(file: string): Promise<string[]> {
  const problems: string[] = []
  const rel = path.relative(PRACTICE_DIR, file).replace(/\\/g, '/').replace(/\.md$/, '')
  if (!fs.existsSync(path.join(root, 'content', `${rel}.md`))) problems.push(`找不到对应的题目 content/${rel}.md`)
  let spec
  try {
    spec = parsePracticeSpec(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return [...problems, `格式错误：${(error as Error).message}`]
  }
  if (spec.dom) return problems
  const testCount = (spec.tests.match(/^\s*test\(/gm) ?? []).length
  if (testCount < 4) problems.push(`只有 ${testCount} 条测试，至少要 4 条`)

  const solution = await runPractice(spec.solution, spec.tests)
  if (solution.error) problems.push(`参考答案：${solution.error}`)
  for (const r of solution.results) if (!r.ok) problems.push(`参考答案没通过"${r.name}"：${r.error?.message}`)
  if (!solution.error && solution.results.length !== testCount) problems.push(`跑了 ${solution.results.length} 条测试，文件里写了 ${testCount} 条`)

  const starter = await runPractice(spec.starter, spec.tests)
  if (starter.error?.startsWith('语法错误')) problems.push(`起始代码：${starter.error}`)
  else if (!starter.error && starter.results.length && starter.results.every((r) => r.ok)) problems.push('起始代码就能通过全部测试，测试太弱了')
  return problems
}

async function main() {
  const only = process.argv.slice(2)
  const files = practiceFiles().filter((f) => !only.length || only.some((o) => f.replace(/\\/g, '/').includes(o)))
  let bad = 0
  for (const file of files) {
    const problems = await checkPracticeFile(file)
    const name = path.relative(PRACTICE_DIR, file)
    if (problems.length) {
      bad++
      console.log(`✗ ${name}`)
      for (const p of problems) console.log(`    ${p}`)
    } else console.log(`✓ ${name}`)
  }
  console.log(`\n${files.length} 个练习，${bad} 个有问题`)
  process.exit(bad ? 1 : 0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
