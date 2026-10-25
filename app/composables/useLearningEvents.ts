export interface LearningEvent {
  /** code_run 在题目里运行代码、practice_pass 默写练习全部通过 */
  type: 'read' | 'reveal' | 'voice' | 'code_run' | 'practice_pass'
  questionId?: number
  /** read、voice 的秒数 */
  value?: number
}

// 待发送的事件，整个页面共用一份
const queue: LearningEvent[] = []

/**
 * 学习事件：攒一批再发，页面隐藏或关闭时用 sendBeacon 发出去（不会因为页面卸载而丢）。
 * 只记登录用户，数据存在自己的库里，用于学习周报
 */
export function useLearningEvents() {
  const { loggedIn } = useUserSession()

  function flush(beacon = false) {
    if (import.meta.server || !queue.length || !loggedIn.value) return
    const events = queue.splice(0, 50)
    const body = JSON.stringify({ events })
    if (beacon && navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'application/json' }))) return
    $fetch('/api/events', { method: 'POST', body: { events } }).catch(() => {
      // 发不出去就算了，统计数据少一点不影响使用
    })
  }

  function track(event: LearningEvent) {
    if (import.meta.server || !loggedIn.value) return
    queue.push(event)
    if (queue.length >= 20) flush()
  }

  return { track, flush }
}

/** 最近这么久没有操作，就不再计入阅读时长（人可能已经走开了） */
const IDLE_MS = 60_000
/** 少于这么多秒的停留不记（快速翻过的题） */
const MIN_SECONDS = 5

/**
 * 记录一道题的有效阅读时长：只在页面处于前台、并且最近一分钟内有滚动、点击或按键时计时。
 * 换题、离开页面、切到后台时把这段时长记成一条 read 事件
 */
export function useReadingTime(questionId: () => number | undefined) {
  const { track, flush } = useLearningEvents()
  let seconds = 0
  let lastActive = Date.now()
  let timer: ReturnType<typeof setInterval> | undefined
  let current = questionId()

  const markActive = () => (lastActive = Date.now())
  const commit = () => {
    if (current !== undefined && seconds >= MIN_SECONDS) track({ type: 'read', questionId: current, value: Math.min(seconds, 1800) })
    seconds = 0
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      commit()
      flush(true)
    } else {
      markActive()
    }
  }

  onMounted(() => {
    current = questionId()
    markActive()
    for (const name of ['scroll', 'keydown', 'pointerdown', 'pointermove', 'touchstart', 'wheel']) {
      window.addEventListener(name, markActive, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    timer = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActive < IDLE_MS) seconds++
    }, 1000)
  })

  // 同一个页面组件里换到另一道题
  watch(questionId, (next) => {
    commit()
    current = next
    markActive()
  })

  onBeforeUnmount(() => {
    commit()
    clearInterval(timer)
    for (const name of ['scroll', 'keydown', 'pointerdown', 'pointermove', 'touchstart', 'wheel']) {
      window.removeEventListener(name, markActive)
    }
    document.removeEventListener('visibilitychange', onVisibility)
  })
}
