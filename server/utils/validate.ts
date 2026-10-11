import type { H3Event } from 'h3'
import type { z } from 'zod'

function fail(error: z.ZodError): never {
  throw createError({ statusCode: 400, message: error.issues[0]?.message ?? '参数不正确' })
}

/** 校验请求体，失败时返回 400 和第一条可读的错误信息 */
export async function readValidated<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(await readBody(event))
  if (!result.success) fail(result.error)
  return result.data
}

export function queryValidated<T extends z.ZodType>(event: H3Event, schema: T): z.infer<T> {
  const result = schema.safeParse(getQuery(event))
  if (!result.success) fail(result.error)
  return result.data
}

export function idParam(event: H3Event, name = 'id'): number {
  const id = Number(getRouterParam(event, name))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, message: 'id 不正确' })
  return id
}
