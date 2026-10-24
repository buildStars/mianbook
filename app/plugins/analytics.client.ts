/**
 * 自建访问统计：每次换页记一条（路径、外站来源、设备类型），后台"访问"页汇总。
 * - 访客 ID 是 localStorage 里的随机串，不用 cookie，不记 IP 和 UA
 * - 开了"请勿追踪"或全局隐私控制的浏览器、自动化浏览器、管理员自己都不记
 * - 水合完成后再记第一页，之后每次路径变化记一次（只改锚点不算）
 */
export default defineNuxtPlugin(() => {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  if (nav.webdriver || nav.doNotTrack === '1' || nav.globalPrivacyControl) return

  const { user } = useUserSession()
  const router = useRouter()

  const visitorId = (() => {
    const fresh = () => crypto.randomUUID().replace(/-/g, '')
    try {
      const saved = localStorage.getItem('mb-visitor')
      if (saved && /^[\w-]{16,32}$/.test(saved)) return saved
      const id = fresh()
      localStorage.setItem('mb-visitor', id)
      return id
    } catch {
      // 隐私模式等存不了时，每次打开算一个新访客
      return fresh()
    }
  })()

  // 浏览器标签页里第一次打开本站算一次访问的开始，只有这一页记外站来源
  let entry = (() => {
    try {
      if (sessionStorage.getItem('mb-visit')) return false
      sessionStorage.setItem('mb-visit', '1')
      return true
    } catch {
      return true
    }
  })()

  function send(path: string) {
    if (user.value?.role === 'admin' || path.startsWith('/admin')) return
    const body = {
      visitorId,
      path,
      entry,
      device: matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop',
      referrer: entry && document.referrer ? document.referrer : undefined,
      utmSource: new URLSearchParams(location.search).get('utm_source') ?? undefined,
    }
    entry = false
    if (navigator.sendBeacon?.('/api/pv', new Blob([JSON.stringify(body)], { type: 'application/json' }))) return
    $fetch('/api/pv', { method: 'POST', body }).catch(() => {
      // 统计发不出去不影响使用
    })
  }

  onNuxtReady(() => {
    send(router.currentRoute.value.path)
    router.afterEach((to, from) => {
      if (to.path !== from.path) send(to.path)
    })
  })
})
