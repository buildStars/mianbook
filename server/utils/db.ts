import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import * as schema from '../db/schema'

export const tables = schema

export function createDb(url: string) {
  // 数据库实例按 UTC 运行（见 scripts/mysql.mjs），这里也按 UTC 解析时间
  const pool = mysql.createPool({ uri: url, connectionLimit: 10, timezone: 'Z', charset: 'utf8mb4' })
  return drizzle({ client: pool, schema, mode: 'default' })
}

export type Db = ReturnType<typeof createDb>

let db: Db | undefined

export function useDb(): Db {
  if (!db) {
    const { databaseUrl } = useRuntimeConfig()
    if (!databaseUrl) {
      throw createError({ statusCode: 500, message: '没有配置数据库连接 NUXT_DATABASE_URL' })
    }
    db = createDb(databaseUrl)
  }
  return db
}
