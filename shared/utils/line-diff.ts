/** 按行对比两段文本，用于后台查看题目的修改历史 */

export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
  /** 旧文本 / 新文本里的行号（从 1 开始）；新增的行没有旧行号，删除的行没有新行号 */
  oldNo?: number
  newNo?: number
}

/** 中间不同的部分超过这个规模（行数相乘）时不再细算，整段当作删除再新增，避免卡住 */
const MAX_CELLS = 4_000_000

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')

  // 先去掉首尾相同的行，通常只剩很小一段需要比较
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const out: DiffLine[] = []
  for (let i = 0; i < start; i++) out.push({ type: 'same', text: a[i]!, oldNo: i + 1, newNo: i + 1 })
  out.push(...diffMiddle(a.slice(start, endA), b.slice(start, endB), start))
  for (let i = endA, j = endB; i < a.length; i++, j++) out.push({ type: 'same', text: a[i]!, oldNo: i + 1, newNo: j + 1 })
  return out
}

/** 最长公共子序列（LCS）求中间段的差异 */
function diffMiddle(a: string[], b: string[], offset: number): DiffLine[] {
  const n = a.length
  const m = b.length
  if (!n || !m || n * m > MAX_CELLS) {
    return [
      ...a.map((text, i): DiffLine => ({ type: 'del', text, oldNo: offset + i + 1 })),
      ...b.map((text, j): DiffLine => ({ type: 'add', text, newNo: offset + j + 1 })),
    ]
  }

  // lcs[i][j]：a[i..] 和 b[j..] 的最长公共子序列长度，存在一维数组里
  const w = m + 1
  const lcs = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]!, oldNo: offset + i + 1, newNo: offset + j + 1 })
      i++
      j++
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      out.push({ type: 'del', text: a[i]!, oldNo: offset + i + 1 })
      i++
    } else {
      out.push({ type: 'add', text: b[j]!, newNo: offset + j + 1 })
      j++
    }
  }
  for (; i < n; i++) out.push({ type: 'del', text: a[i]!, oldNo: offset + i + 1 })
  for (; j < m; j++) out.push({ type: 'add', text: b[j]!, newNo: offset + j + 1 })
  return out
}

/** 增删了多少行 */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.type === 'add') added++
    else if (l.type === 'del') removed++
  }
  return { added, removed }
}

export interface DiffHunk {
  lines: DiffLine[]
  /** 这一块前面省略了多少行没有改动的内容 */
  skipped: number
}

/** 只保留改动附近的几行上下文，其余没有改动的行折叠起来 */
export function diffHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const keep = new Uint8Array(lines.length)
  lines.forEach((l, i) => {
    if (l.type === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1
  })
  const hunks: DiffHunk[] = []
  let skipped = 0
  let current: DiffHunk | null = null
  lines.forEach((l, i) => {
    if (!keep[i]) {
      skipped++
      current = null
      return
    }
    if (!current) {
      current = { lines: [], skipped }
      hunks.push(current)
      skipped = 0
    }
    current.lines.push(l)
  })
  return hunks
}
