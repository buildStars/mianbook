/** 题目里可能有反引号包起来的代码，比如 `<script setup>`，拆成片段后由模板渲染，避免使用 v-html */
export function titleSegments(title: string): { text: string; code: boolean }[] {
  return title
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') ? { text: part.slice(1, -1), code: true } : { text: part, code: false },
    )
}

export const plainTitle = (title: string) => title.replace(/`/g, '')

export const STATUS_LABELS = {
  weak: '不会',
  fuzzy: '模糊',
  mastered: '掌握',
} as const

/** 难度 1～3，前台和后台共用同一套叫法 */
export const DIFFICULTY_LABELS: Record<number, string> = {
  1: '基础',
  2: '进阶',
  3: '深入',
}
