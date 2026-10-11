import { defineConfig } from 'drizzle-kit'

try {
  process.loadEnvFile('.env')
} catch {
  // 没有 .env 时使用已有的环境变量
}

export default defineConfig({
  dialect: 'mysql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: { url: process.env.NUXT_DATABASE_URL ?? '' },
})
