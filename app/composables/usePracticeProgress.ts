const PASSED_KEY = 'handbook-practice-passed'
const draftKey = (id: number) => `handbook-practice-draft-${id}`

/**
 * 默写练习的本机记录：哪些练习全部通过过（题目 id → 时间），以及每道练习没写完的代码草稿。
 * 只存在这台设备的浏览器里；掌握程度另外走学习记录（会同步到账号）
 */
export function usePracticeProgress() {
  const passed = useState<Record<number, string>>('practice-passed', () => ({}))

  function load() {
    if (import.meta.server) return
    try {
      passed.value = JSON.parse(localStorage.getItem(PASSED_KEY) || '{}')
    } catch {
      passed.value = {}
    }
  }

  function markPassed(id: number) {
    passed.value = { ...passed.value, [id]: new Date().toISOString() }
    try {
      localStorage.setItem(PASSED_KEY, JSON.stringify(passed.value))
    } catch {
      // 隐私模式等情况下无法写入
    }
  }

  function readDraft(id: number): string | null {
    try {
      return localStorage.getItem(draftKey(id))
    } catch {
      return null
    }
  }

  /** 草稿和起始代码一样时删掉，不占地方 */
  function saveDraft(id: number, code: string, starter: string) {
    try {
      if (code === starter) localStorage.removeItem(draftKey(id))
      else localStorage.setItem(draftKey(id), code)
    } catch {
      // 同上
    }
  }

  return { passed, load, markPassed, readDraft, saveDraft }
}
