import { z } from 'zod'

const schema = z.object({ q: z.string().max(100, '关键词太长了').default('') })

export default defineEventHandler(async (event) => {
  const { q } = queryValidated(event, schema)
  return searchQuestions(q)
})
