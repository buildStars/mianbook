/**
 * 收藏和笔记：从学习记录里挑出来，配上题目信息。收藏按目录顺序，笔记按最近修改在前。
 * 头部的"我的"面板、个人中心和收藏页共用；学习记录只在浏览器端加载，服务端渲染时都是空的
 */
export function useCollection() {
  const { all } = useOutline()
  const { records } = useStudy()

  const starred = computed(() => all.value.filter((q) => records.value[q.id]?.starred))
  const noted = computed(() =>
    all.value
      .filter((q) => records.value[q.id]?.note?.trim())
      .sort((a, b) => records.value[b.id]!.updatedAt.localeCompare(records.value[a.id]!.updatedAt)),
  )
  const mastered = computed(() => all.value.filter((q) => records.value[q.id]?.status === 'mastered').length)

  return { starred, noted, mastered, total: computed(() => all.value.length) }
}
