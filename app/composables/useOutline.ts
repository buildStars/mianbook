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

/** 全站目录：同一个 key 在各组件间共享，只请求一次 */
export function useOutline() {
  const { data, refresh } = useFetch<OutlinePart[]>('/api/outline', {
    key: 'outline',
    default: () => [],
  })

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

  return { outline: data, all, refresh, firstPathOf }
}
