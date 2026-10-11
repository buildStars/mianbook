export interface AdminCategory {
  id: number
  partId: number
  slug: string
  title: string
  sort: number
  questionCount: number
}

export interface AdminPart {
  id: number
  slug: string
  title: string
  sort: number
  categories: AdminCategory[]
}

/** 后台用的目录结构（含空分类），多个页面共享 */
export function useAdminStructure() {
  const { data, refresh } = useFetch<AdminPart[]>('/api/admin/structure', {
    key: 'admin-structure',
    default: () => [],
  })
  return { structure: data, refresh }
}

/** 把接口错误转成提示文字 */
export function errorMessage(error: unknown): string {
  const e = error as { data?: { message?: string }; message?: string }
  return e?.data?.message ?? e?.message ?? '操作失败'
}
