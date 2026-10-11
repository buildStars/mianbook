import type { StudyRecord, StudyRecordMap, StudyStatus } from '#shared/types/handbook'

const GUEST_KEY = 'handbook-guest-progress'

function readGuest(): StudyRecordMap {
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeGuest(records: StudyRecordMap) {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(records))
  } catch {
    // 隐私模式等情况下无法写入
  }
}

const noteTimers = new Map<number, ReturnType<typeof setTimeout>>()

/**
 * 学习记录：登录后存在服务端（多设备同步），未登录时先存在本地，登录后自动合并。
 * 只在浏览器端加载，服务端渲染时为空。
 */
export function useStudy() {
  const { loggedIn } = useUserSession()
  const records = useState<StudyRecordMap>('study-records', () => ({}))
  const ready = useState('study-ready', () => false)
  const error = useState<string | null>('study-error', () => null)

  async function load() {
    if (import.meta.server) return
    if (loggedIn.value) {
      const guest = readGuest()
      // 把未登录时记下的内容合并到账号里
      if (Object.keys(guest).length) {
        await $fetch('/api/progress/import', { method: 'POST', body: { records: guest } }).catch(() => null)
        localStorage.removeItem(GUEST_KEY)
      }
      records.value = await $fetch<StudyRecordMap>('/api/progress')
    } else {
      records.value = readGuest()
    }
    ready.value = true
  }

  function setLocal(id: number, record: StudyRecord | null) {
    const next = { ...records.value }
    if (record) next[id] = record
    else delete next[id]
    records.value = next
    if (!loggedIn.value) writeGuest(next)
  }

  async function save(id: number, patch: Partial<Pick<StudyRecord, 'status' | 'starred' | 'note'>>) {
    const current = records.value[id]
    const merged: StudyRecord = {
      status: current?.status ?? null,
      starred: current?.starred ?? false,
      note: current?.note ?? null,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    const empty = !merged.status && !merged.starred && !merged.note?.trim()
    setLocal(id, empty ? null : merged)
    if (!loggedIn.value) return
    try {
      const saved = await $fetch<StudyRecord | null>(`/api/progress/${id}`, { method: 'PUT', body: patch })
      // 保存期间用户可能又改了笔记，以本地为准，只更新时间
      if (saved && records.value[id]) setLocal(id, { ...records.value[id]!, updatedAt: saved.updatedAt })
      error.value = null
    } catch {
      error.value = '保存失败，请检查网络后重试'
    }
  }

  const setStatus = (id: number, status: StudyStatus | null) => save(id, { status })
  const toggleStar = (id: number) => save(id, { starred: !records.value[id]?.starred })

  /** 笔记输入频繁，本地立即更新，服务端延迟保存 */
  function setNote(id: number, note: string) {
    const current = records.value[id]
    setLocal(id, {
      status: current?.status ?? null,
      starred: current?.starred ?? false,
      note,
      updatedAt: new Date().toISOString(),
    })
    clearTimeout(noteTimers.get(id))
    noteTimers.set(
      id,
      setTimeout(() => save(id, { note }), 600),
    )
  }

  async function importRecords(data: Record<string, unknown>) {
    if (!loggedIn.value) throw new Error('请先登录再导入')
    const result = await $fetch<{ imported: number; skipped: number }>('/api/progress/import', {
      method: 'POST',
      body: { records: data },
    })
    await load()
    return result
  }

  async function clearAll() {
    if (loggedIn.value) await $fetch('/api/progress', { method: 'DELETE' })
    else localStorage.removeItem(GUEST_KEY)
    records.value = {}
  }

  return { records, ready, error, load, setStatus, toggleStar, setNote, importRecords, clearAll }
}
