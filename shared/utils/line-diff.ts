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

export interface DiffHunk<T extends DiffLine = DiffLine> {
  lines: T[]
  /** 这一块前面省略了多少行没有改动的内容 */
  skipped: number
}

/** 只保留改动附近的几行上下文，其余没有改动的行折叠起来 */
export function diffHunks<T extends DiffLine>(lines: T[], context = 3): DiffHunk<T>[] {
  const keep = new Uint8Array(lines.length)
  lines.forEach((l, i) => {
    if (l.type === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1
  })
  const hunks: DiffHunk<T>[] = []
  let skipped = 0
  let current: DiffHunk<T> | null = null
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

export interface InlineSegment {
  text: string
  /** 这一段是行内改动的部分 */
  changed: boolean
}

/**
 * 行内改动：连续删除的几行紧跟着连续新增的几行时，按顺序两两配对，
 * 去掉共同的开头和结尾，中间就是改动的部分。中文的一段话通常是一整行，这样能看出具体改了哪几个字
 */
export function withInlineChanges(lines: DiffLine[]): (DiffLine & { segments?: InlineSegment[] })[] {
  const out: (DiffLine & { segments?: InlineSegment[] })[] = lines.map((l) => ({ ...l }))
  let i = 0
  while (i < out.length) {
    if (out[i]!.type !== 'del') {
      i++
      continue
    }
    const delStart = i
    while (i < out.length && out[i]!.type === 'del') i++
    const addStart = i
    while (i < out.length && out[i]!.type === 'add') i++
    const pairs = Math.min(addStart - delStart, i - addStart)
    for (let k = 0; k < pairs; k++) {
      const [a, b] = inlinePair(out[delStart + k]!.text, out[addStart + k]!.text)
      if (a && b) {
        out[delStart + k]!.segments = a
        out[addStart + k]!.segments = b
      }
    }
  }
  return out
}

function inlinePair(oldText: string, newText: string): [InlineSegment[], InlineSegment[]] | [null, null] {
  // 按字符（而不是 UTF-16 码元）比较，避免把 emoji 之类的字拆成两半
  const a = Array.from(oldText)
  const b = Array.from(newText)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  // 几乎整行都不一样时，标出来反而更乱
  if (start + (a.length - endA) < 2) return [null, null]
  const split = (chars: string[], end: number): InlineSegment[] =>
    [
      { text: chars.slice(0, start).join(''), changed: false },
      { text: chars.slice(start, end).join(''), changed: true },
      { text: chars.slice(end).join(''), changed: false },
    ].filter((s) => s.text)
  return [split(a, endA), split(b, endB)]
}
