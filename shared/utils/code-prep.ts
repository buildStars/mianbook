import { parse } from 'acorn'

/**
 * 题目里代码块"运行"前的准备（在浏览器里按需加载，acorn 不进首屏）：
 * 1. 同一道题前面代码块里定义的函数、类、变量带上（后面的代码块常常直接用前面写好的函数），
 *    演示用的 console.log 之类的语句不带，前面定义的输出也静音；当前代码块重新定义的同名声明以当前为准
 * 2. 去掉 export（代码块常写成 export function，单独运行时没有意义）；有 import 的不能运行（沙箱不能联网）
 * 3. 每个循环体开头插入 __loopGuard()，循环总次数超过上限就抛错，免得死循环卡住页面
 * 4. 顶层表达式后面紧跟着注释的（题目里常写 `stringify(x) // '{"d":1}'`，结果只写在注释里），用 __show() 包起来显示返回值，
 *    像浏览器控制台那样；赋值、console.xxx()、setTimeout() 这类不显示
 * __mute、__loopGuard、__done、__show 由运行页（server/utils/code-runner-page.ts）提供，循环次数上限也在那里
 */

export type PrepareResult =
  | {
      ok: true
      /** 交给运行页执行的完整代码（ES 模块，可以用顶层 await） */
      source: string
      /** 当前代码块从 source 的第几行开始，用来把报错行号换算回代码块里的行号 */
      blockStartLine: number
      /** 带上了前面几段代码块里的定义 */
      preludeCount: number
      /** 这段代码只有定义（函数、类、变量），自己不会有输出 */
      onlyDeclarations: boolean
    }
  | { ok: false; message: string; line?: number }

interface Edit {
  start: number
  end: number
  text: string
}

type AstNode = { type: string; start: number; end: number; [key: string]: any }

const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'])
const DECLARATIONS = new Set(['FunctionDeclaration', 'ClassDeclaration', 'VariableDeclaration'])
const GUARD = '__loopGuard();'
/** 这些调用的返回值没有意义（定时器编号之类），不显示 */
const SILENT_CALLS = new Set(['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'requestAnimationFrame'])

interface Comment {
  start: number
  loc: { start: { line: number } }
}

function parseModule(code: string, comments: Comment[] = []): AstNode {
  return parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
    onComment: comments as never,
  }) as unknown as AstNode
}

/** 顶层表达式语句要不要显示返回值：同一行后面或者下一行整行是注释（作者在注释里写了结果），并且不是赋值、打印、定时器 */
function showsResult(statement: AstNode, code: string, comments: Comment[]): boolean {
  if (statement.type !== 'ExpressionStatement' || statement.directive) return false
  const expr = statement.expression as AstNode
  if (expr.type === 'AssignmentExpression' || expr.type === 'UpdateExpression') return false
  if (expr.type === 'UnaryExpression' && (expr.operator === 'delete' || expr.operator === 'void')) return false
  const call = (expr.type === 'AwaitExpression' ? expr.argument : expr) as AstNode
  if (call.type === 'CallExpression') {
    const callee = call.callee as AstNode
    if (callee.type === 'Identifier' && SILENT_CALLS.has(callee.name)) return false
    if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'console') return false
  }
  const endLine = statement.loc.end.line
  const lineEnd = code.indexOf('\n', statement.end)
  return comments.some((c) => {
    if (c.start >= statement.end && (lineEnd === -1 || c.start < lineEnd)) return true
    return c.loc.start.line === endLine + 1 && !code.slice(code.lastIndexOf('\n', c.start - 1) + 1, c.start).trim()
  })
}

/** 每个循环体开头插入循环保护；循环体不是 { } 的补上括号 */
function loopGuards(root: AstNode, edits: Edit[]) {
  walk(root, (node) => {
    if (!LOOPS.has(node.type)) return
    const body = node.body as AstNode
    if (body.type === 'BlockStatement') edits.push({ start: body.start + 1, end: body.start + 1, text: GUARD })
    else {
      edits.push({ start: body.start, end: body.start, text: `{${GUARD}` })
      edits.push({ start: body.end, end: body.end, text: '}' })
    }
  })
}

/** 去掉 export：export function f → function f，export default 表达式 → const __default = 表达式，export { a } 整句去掉 */
function exportEdits(statement: AstNode): Edit | null {
  if (statement.type === 'ExportNamedDeclaration') {
    if (statement.declaration) return { start: statement.start, end: statement.declaration.start, text: '' }
    return { start: statement.start, end: statement.end, text: '' }
  }
  if (statement.type === 'ExportAllDeclaration') return { start: statement.start, end: statement.end, text: '' }
  if (statement.type === 'ExportDefaultDeclaration') {
    const decl = statement.declaration as AstNode
    const named = (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id
    return { start: statement.start, end: decl.start, text: named ? '' : 'const __default = ' }
  }
  return null
}

/** 把 [from, to) 这一段代码套上修改（修改的位置是整段代码里的绝对位置） */
function applyEdits(code: string, edits: Edit[], from = 0, to = code.length): string {
  let out = code.slice(from, to)
  const inside = edits.filter((e) => e.start >= from && e.end <= to).sort((a, b) => b.start - a.start || b.end - a.end)
  for (const e of inside) out = out.slice(0, e.start - from) + e.text + out.slice(e.end - from)
  return out
}

/** 一条顶层语句声明了哪些名字（只看函数、类和变量声明，解构取出全部变量名） */
function declaredNames(statement: AstNode): string[] {
  const node = statement.type.startsWith('Export') && statement.declaration ? (statement.declaration as AstNode) : statement
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') return node.id ? [node.id.name] : []
  if (node.type !== 'VariableDeclaration') return []
  const names: string[] = []
  const collect = (pattern: AstNode | null) => {
    if (!pattern) return
    if (pattern.type === 'Identifier') names.push(pattern.name)
    else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) collect(p.type === 'RestElement' ? p.argument : p.value)
    else if (pattern.type === 'ArrayPattern') for (const el of pattern.elements) collect(el)
    else if (pattern.type === 'RestElement') collect(pattern.argument)
    else if (pattern.type === 'AssignmentPattern') collect(pattern.left)
  }
  for (const d of node.declarations) collect(d.id)
  return names
}

function isDeclaration(statement: AstNode): boolean {
  if (DECLARATIONS.has(statement.type) || statement.type === 'EmptyStatement') return true
  if (statement.type === 'ExportNamedDeclaration') return !!statement.declaration
  if (statement.type === 'ExportDefaultDeclaration') {
    const decl = statement.declaration as AstNode
    return (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && !!decl.id
  }
  return false
}

function walk(node: AstNode, visit: (n: AstNode) => void) {
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') walk(child, visit)
    } else if (value && typeof value.type === 'string') walk(value, visit)
  }
}

/** 成员访问链里有没有 .prototype（Array.prototype.myMap、Foo.prototype） */
function onPrototype(node: AstNode | undefined): boolean {
  for (let n = node; n && n.type === 'MemberExpression'; n = n.object) {
    if (!n.computed && n.property.name === 'prototype') return true
  }
  return false
}

const PROTO_CALLS = new Set(['defineProperty', 'defineProperties', 'assign', 'setPrototypeOf'])

/**
 * 往原型上挂方法的语句（Array.prototype.myMap = …、循环里 Object.defineProperty(Array.prototype, …)）也算定义：
 * 后面的代码块会直接调用这些方法。里面有 console 的是演示，不算
 */
function isPrototypeSetup(statement: AstNode): boolean {
  let setup = false
  let prints = false
  walk(statement, (n) => {
    if (n.type === 'AssignmentExpression' && onPrototype(n.left)) setup = true
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier') {
      if (n.callee.object.name === 'Object' && PROTO_CALLS.has(n.callee.property.name) && onPrototype(n.arguments[0])) setup = true
      if (n.callee.object.name === 'console') prints = true
    }
  })
  return setup && !prints
}

const isDefinition = (statement: AstNode) => isDeclaration(statement) || isPrototypeSetup(statement)

const lineCount = (text: string) => text.split('\n').length

/** acorn 的报错信息带 "(行:列)"，去掉后换成中文 */
function syntaxError(error: unknown): { message: string; line?: number } {
  const e = error as { message?: string; loc?: { line: number } }
  const message = (e.message ?? String(error)).replace(/\s*\(\d+:\d+\)$/, '')
  return { message: `语法错误：${message}`, line: e.loc?.line }
}

export function prepareRun(code: string, previous: string[] = []): PrepareResult {
  let ast: AstNode
  const comments: Comment[] = []
  try {
    ast = parseModule(code, comments)
  } catch (error) {
    return { ok: false, ...syntaxError(error) }
  }
  const imported = (ast.body as AstNode[]).find((s) => s.type === 'ImportDeclaration')
  if (imported) {
    return {
      ok: false,
      message: '这段代码用 import 引入了其他模块，运行环境不能联网下载依赖，没法直接运行',
      line: imported.loc.start.line,
    }
  }

  // 当前代码块：去掉 export，加循环保护，注释里写了结果的表达式显示返回值
  const edits: Edit[] = []
  for (const statement of ast.body as AstNode[]) {
    const edit = exportEdits(statement)
    if (edit) edits.push(edit)
    if (showsResult(statement, code, comments)) {
      const expr = statement.expression as AstNode
      edits.push({ start: expr.start, end: expr.start, text: '__show((' }, { start: expr.end, end: expr.end, text: '))' })
    }
  }
  loopGuards(ast, edits)
  const block = applyEdits(code, edits)
  const own = new Set((ast.body as AstNode[]).flatMap(declaredNames))
  const onlyDeclarations = (ast.body as AstNode[]).every((s) => isDefinition(s) || s.type.startsWith('Export'))

  // 前面代码块里的声明：后面重新定义的同名声明覆盖前面的，当前代码块里有的不带
  // setup 是往原型上挂方法的语句，没有名字，总是带上（重复挂也只是覆盖）
  const candidates: { text: string; names: string[]; from: number; setup?: boolean }[] = []
  previous.forEach((prev, index) => {
    let prevAst: AstNode
    try {
      prevAst = parseModule(prev)
    } catch {
      return // 前面的代码块本身有语法错误（或者不是完整代码），跳过
    }
    const prevEdits: Edit[] = []
    loopGuards(prevAst, prevEdits)
    for (const statement of prevAst.body as AstNode[]) {
      if (isPrototypeSetup(statement)) {
        candidates.push({ text: applyEdits(prev, prevEdits, statement.start, statement.end), names: [], from: index, setup: true })
        continue
      }
      if (!isDeclaration(statement)) continue
      const edit = exportEdits(statement)
      candidates.push({
        text: applyEdits(prev, edit ? [...prevEdits, edit] : prevEdits, statement.start, statement.end),
        names: declaredNames(statement),
        from: index,
      })
    }
  })
  const kept = candidates.filter((c, i) => {
    if (c.setup) return true
    if (!c.names.length || c.names.some((n) => own.has(n))) return false
    return !candidates.slice(i + 1).some((later) => later.names.some((n) => c.names.includes(n)))
  })

  if (!kept.length) return { ok: true, source: `${block}\n;__done();`, blockStartLine: 1, preludeCount: 0, onlyDeclarations }
  const prelude = `__mute(true);\n${kept.map((c) => c.text).join('\n')}\n__mute(false);\n`
  return {
    ok: true,
    source: `${prelude}${block}\n;__done();`,
    blockStartLine: lineCount(prelude),
    preludeCount: new Set(kept.map((c) => c.from)).size,
    onlyDeclarations,
  }
}
