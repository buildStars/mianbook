import type { OutlinePart } from '#shared/types/handbook'

export interface FlatQuestion {
  id: number
  num: number
  slug: string
  title: string
  difficulty: number
  path: string
  partSlug: string
  partTitle: string
  categoryTitle: string
}

/** 全站目录：由 plugins/outline.ts 在水合前加载好，各组件共享同一份 */
export function useOutline() {
  const data = useNuxtApp().$outline

  const all = computed<FlatQuestion[]>(() =>
    data.value.flatMap((part) =>
      part.categories.flatMap((cat) =>
        cat.questions.map((q) => ({
          ...q,
          partSlug: part.slug,
          partTitle: part.title,
          categoryTitle: cat.title,
        })),
      ),
    ),
  )

  const firstPathOf = (part: OutlinePart) => part.categories[0]?.questions[0]?.path ?? '/'
  const refresh = () => refreshNuxtData('outline')

  return { outline: data, all, refresh, firstPathOf }
}
