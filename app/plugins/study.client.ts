/**
 * 浏览器端加载学习记录、复习概况、"上次看到的题"和用户自己的 AI Key；登录状态变化后重新加载学习记录（登录时会合并本地记录）。
 * 必须等水合全部完成再加载：服务端渲染时没有这些数据，提前填进去会导致水合不匹配。
 * 页面和布局在 Suspense 里异步水合，app:mounted 时还没水合完，所以用 onNuxtReady。
 */
export default defineNuxtPlugin(() => {
  const { loggedIn } = useUserSession()
  const { load } = useStudy()
  const { load: loadLastVisited } = useLastVisited()
  const { load: loadAiKey } = useAiKey()
  const { refresh: refreshReview } = useReview()
  onNuxtReady(() => {
    load()
    loadLastVisited()
    loadAiKey()
    refreshReview()
    watch(loggedIn, () => {
      load()
      refreshReview()
    })
  })
})
