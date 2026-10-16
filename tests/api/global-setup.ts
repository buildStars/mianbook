/**
 * 接口测试的全局准备：
 * 1. 重建测试库 handbook_test（用本机 MySQL 的 root 账号，只监听 127.0.0.1），执行迁移并导入题库
 * 2. 构建一份测试专用的产物（.output-test），代码没变时跳过构建
 * 3. 启动模拟大模型和服务（邮件写到临时发件箱），把地址传给测试
 * 不会读写正式库，也不会影响正在运行的开发服务器
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { TestProject } from 'vitest/node'
import { startMockLlm, MOCK_KEY } from '../fixtures/mock-llm'

const root = path.resolve(import.meta.dirname, '../..')
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3307)
export const TEST_DB = 'handbook_test'
export const TEST_DB_URL = `mysql://root@127.0.0.1:${MYSQL_PORT}/${TEST_DB}`
/** 每个用户 24 小时内的站点 Key 次数；测限流时直接往库里插调用记录 */
export const DAILY_LIMIT = 20

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
    mockUrl: string
    dbUrl: string
    dailyLimit: number
    contentDir: string
    outboxDir: string
  }
}

const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
  })

const freePort = () =>
  new Promise<number>((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
  })

/** 源码最近一次修改的时间，用来判断要不要重新构建 */
function latestSourceMtime(): number {
  let latest = 0
  const walk = (p: string) => {
    const stat = fs.statSync(p)
    if (stat.isDirectory()) for (const name of fs.readdirSync(p)) walk(path.join(p, name))
    else latest = Math.max(latest, stat.mtimeMs)
  }
  for (const p of ['app', 'server', 'shared', 'nuxt.config.ts', 'package-lock.json']) walk(path.join(root, p))
  return latest
}

/** 直接用 node 运行依赖里的命令行入口，不经过 shell */
const run = (script: string, args: string[], env: NodeJS.ProcessEnv) =>
  execFileSync(process.execPath, [path.join(root, 'node_modules', script), ...args], { cwd: root, env, stdio: 'pipe' })

export default async function setup(project: TestProject) {
  if (!(await portOpen(MYSQL_PORT))) {
    throw new Error(`本机 MySQL（端口 ${MYSQL_PORT}）没有运行，请先执行 npm run db:start`)
  }

  // 1. 测试库：每次重建，保证测试之间互不影响
  const mysql = await import('mysql2/promise')
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: MYSQL_PORT, user: 'root' })
  await conn.query(`DROP DATABASE IF EXISTS ${TEST_DB}`)
  await conn.query(`CREATE DATABASE ${TEST_DB} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
  await conn.end()
  const dbEnv = { ...process.env, NUXT_DATABASE_URL: TEST_DB_URL }
  run('tsx/dist/cli.mjs', ['scripts/db.ts', 'migrate'], dbEnv)
  run('tsx/dist/cli.mjs', ['scripts/db.ts', 'import'], dbEnv)

  // 2. 构建测试产物
  const entry = path.join(root, '.output-test/server/index.mjs')
  const built = fs.existsSync(entry) ? fs.statSync(entry).mtimeMs : 0
  if (built < latestSourceMtime()) {
    run('nuxt/bin/nuxt.mjs', ['build'], { ...process.env, HANDBOOK_TEST_BUILD: '1' })
  }

  // 3. 后台改题会写回 content 目录：测试用一份临时拷贝，绝不能写到项目里的 content/
  const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handbook-content-'))
  fs.cpSync(path.join(root, 'content'), contentDir, { recursive: true })

  // 4. 邮件不真发，写到临时发件箱，测试从这里读验证码
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handbook-outbox-'))

  // 5. 启动模拟大模型和服务
  const llm = await startMockLlm()
  const port = await freePort()
  const server: ChildProcess = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      NUXT_DATABASE_URL: TEST_DB_URL,
      NUXT_SESSION_PASSWORD: crypto.randomBytes(24).toString('hex'),
      NUXT_AI_API_KEY: MOCK_KEY,
      NUXT_AI_BASE_URL: llm.url,
      NUXT_AI_MODEL: 'mock-model',
      NUXT_AI_DAILY_LIMIT: String(DAILY_LIMIT),
      NUXT_AI_EXTRA_HOSTS: '',
      NUXT_CONTENT_DIR: contentDir,
      NUXT_EMBED_BASE_URL: llm.url,
      NUXT_EMBED_API_KEY: MOCK_KEY,
      NUXT_EMBED_MODEL: 'mock-embed',
      NUXT_EMBED_BATCH_SIZE: '32',
      // 重排沿用上面的地址和 Key
      NUXT_RERANK_MODEL: 'mock-rerank',
      NUXT_MAIL_OUTBOX_DIR: outboxDir,
      NUXT_MAIL_FROM: '测试 <noreply@example.test>',
      // 测试请求都来自本机：用 X-Forwarded-For 给每次注册分配不同的 IP，按 IP 限流的逻辑也能测
      NUXT_AUTH_TRUST_PROXY: 'true',
      NUXT_AUTH_CODE_DAILY_TOTAL: '100000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  server.stdout?.on('data', (d) => (logs += d))
  server.stderr?.on('data', (d) => (logs += d))

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/ai/status`)
      if (res.ok) break
    } catch {
      // 还没启动好
    }
    if (server.exitCode !== null) throw new Error(`测试服务启动失败：\n${logs}`)
    await new Promise((r) => setTimeout(r, 300))
  }

  project.provide('baseUrl', baseUrl)
  project.provide('mockUrl', llm.url)
  project.provide('dbUrl', TEST_DB_URL)
  project.provide('dailyLimit', DAILY_LIMIT)
  project.provide('contentDir', contentDir)
  project.provide('outboxDir', outboxDir)

  return async () => {
    server.kill()
    await llm.close()
    // 服务端日志留着排查失败的测试
    fs.writeFileSync(path.join(root, '.output-test', 'server.log'), logs)
    fs.rmSync(contentDir, { recursive: true, force: true })
    fs.rmSync(outboxDir, { recursive: true, force: true })
  }
}
