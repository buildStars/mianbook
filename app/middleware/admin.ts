export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()
  if (!loggedIn.value) return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
  if (user.value?.role !== 'admin') {
    return abortNavigation(createError({ statusCode: 403, statusMessage: '这个页面需要管理员权限' }))
  }
})
