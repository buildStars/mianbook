import { z } from 'zod'

const schema = z.object({ markdown: z.string().max(200_000, '正文太长了') })

/** 编辑器实时预览：用和正式发布完全相同的渲染流程 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { markdown } = await readValidated(event, schema)
  const { html, toc } = await renderMarkdown(markdown)
  return { html, toc }
})
