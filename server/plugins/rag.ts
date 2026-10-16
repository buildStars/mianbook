/** 服务启动后在后台同步一次问手册的检索索引：新部署的题、换了向量模型、上次没生成完的向量都会补上 */
export default defineNitroPlugin(() => {
  scheduleRagSync(2000)
})
