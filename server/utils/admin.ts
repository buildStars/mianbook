import { z } from 'zod'

export const slugSchema = z
  .string()
  .trim()
  .min(1, '请填写 slug')
  .max(64, 'slug 最多 64 个字符')
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug 只能包含小写字母、数字和连字符，且以字母或数字开头')

export const questionSchema = z.object({
  categoryId: z.number().int().positive('请选择分类'),
  slug: slugSchema.max(128, 'slug 最多 128 个字符'),
  title: z.string().trim().min(1, '请填写题目').max(255, '题目最多 255 个字'),
  difficulty: z.number().int().min(1).max(3),
  tags: z.array(z.string().trim().min(1).max(16)).max(6, '标签最多 6 个'),
  contentMd: z.string().max(200_000, '正文太长了'),
  sort: z.number().int().min(0).optional(),
  status: z.enum(['draft', 'published']),
})

/** MySQL 唯一索引冲突 */
export function isDuplicateError(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } }
  return e?.code === 'ER_DUP_ENTRY' || e?.cause?.code === 'ER_DUP_ENTRY'
}
