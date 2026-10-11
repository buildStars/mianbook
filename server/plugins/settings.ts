/** 处理请求前确保站点设置已经从数据库读出来，并且不超过 30 秒 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', async () => {
    await refreshSettingsIfStale()
  })
})
