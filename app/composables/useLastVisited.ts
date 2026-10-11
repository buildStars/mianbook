const KEY = 'handbook-last-visited'

export interface LastVisited {
  path: string
  title: string
  num: number
  at: string
}

/** 记住上次看到哪道题，首页提供"继续上次"。只存在本机浏览器 */
export function useLastVisited() {
  const last = useState<LastVisited | null>('last-visited', () => null)

  function load() {
    try {
      last.value = JSON.parse(localStorage.getItem(KEY) || 'null')
    } catch {
      last.value = null
    }
  }

  function save(entry: Omit<LastVisited, 'at'>) {
    const record = { ...entry, at: new Date().toISOString() }
    last.value = record
    try {
      localStorage.setItem(KEY, JSON.stringify(record))
    } catch {
      // 隐私模式等情况下无法写入
    }
  }

  return { last, load, save }
}
