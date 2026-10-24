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

/**
 * 分类的"××面试题"叫法：分类名以英文结尾时（JavaScript、Next.js）中间空一格，中文直接连写；
 * "前端手写题"这类本身带"题"的不再加
 */
export const categoryHeading = (title: string) => (title.endsWith('题') ? title : `${title}${/[\x21-\x7e]$/.test(title) ? ' ' : ''}面试题`)

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
