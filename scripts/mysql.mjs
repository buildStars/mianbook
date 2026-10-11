// 项目内的 MySQL 开发实例：数据放在 .mysql/ 下，只监听 127.0.0.1，不注册系统服务。
// 用法：node scripts/mysql.mjs <init|start|stop|status>
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const envFile = path.join(root, '.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

const PORT = Number(process.env.MYSQL_PORT || 3307)
const DB_NAME = 'handbook'
const DB_USER = 'handbook'
const home = path.join(root, '.mysql')
const dataDir = path.join(home, 'data')
const logFile = path.join(home, 'mysqld.log')

// Windows 上默认使用官方安装目录；其他系统或自定义安装可以用 MYSQL_HOME 指定
const mysqlHome =
  process.env.MYSQL_HOME ||
  (process.platform === 'win32' ? 'C:\\Program Files\\MySQL\\MySQL Server 8.0' : '')
const bin = (name) =>
  mysqlHome ? path.join(mysqlHome, 'bin', process.platform === 'win32' ? `${name}.exe` : name) : name

const rootArgs = ['--user=root', '--host=127.0.0.1', `--port=${PORT}`, '--protocol=TCP']

function isRunning() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: PORT })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

async function waitUntil(expect, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if ((await isRunning()) === expect) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

function sql(statements) {
  execFileSync(bin('mysql'), [...rootArgs, `--execute=${statements}`], { stdio: 'inherit' })
}

/** 把键值写入 .env：已有的键不覆盖 */
function ensureEnv(values) {
  const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf-8') : ''
  const lines = []
  for (const [key, value] of Object.entries(values)) {
    if (!new RegExp(`^${key}=`, 'm').test(current)) lines.push(`${key}=${value}`)
  }
  if (lines.length) {
    const prefix = current && !current.endsWith('\n') ? '\n' : ''
    fs.appendFileSync(envFile, `${prefix}${lines.join('\n')}\n`)
  }
  return lines.length
}

async function start() {
  if (await isRunning()) {
    console.log(`MySQL 已在 127.0.0.1:${PORT} 运行`)
    return
  }
  if (!fs.existsSync(dataDir)) {
    console.error('还没有初始化，请先运行 npm run db:init')
    process.exit(1)
  }
  fs.mkdirSync(path.join(home, 'uploads'), { recursive: true })
  const child = spawn(
    bin('mysqld'),
    [
      `--datadir=${dataDir}`,
      `--port=${PORT}`,
      '--bind-address=127.0.0.1',
      '--mysqlx=OFF',
      '--character-set-server=utf8mb4',
      '--default-time-zone=+00:00',
      `--secure-file-priv=${path.join(home, 'uploads')}`,
      `--log-error=${logFile}`,
      `--pid-file=${path.join(home, 'mysqld.pid')}`,
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  )
  child.unref()
  if (await waitUntil(true)) console.log(`MySQL 已启动：127.0.0.1:${PORT}（日志：.mysql/mysqld.log）`)
  else {
    console.error('MySQL 启动超时，请查看 .mysql/mysqld.log')
    process.exit(1)
  }
}

async function stop() {
  if (!(await isRunning())) {
    console.log('MySQL 没有运行')
    return
  }
  const pidFile = path.join(home, 'mysqld.pid')
  const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf-8').trim()) : 0
  try {
    execFileSync(bin('mysqladmin'), [...rootArgs, 'shutdown'], { stdio: 'inherit' })
  } catch {
    // 无法正常关闭时，按 pid 文件结束进程
    if (pid) process.kill(pid)
  }
  // 端口关闭后进程可能还在刷盘，等进程真正退出，否则马上再启动会因为数据文件被占用而失败
  const alive = () => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  const start = Date.now()
  while (pid && alive() && Date.now() - start < 30_000) await new Promise((r) => setTimeout(r, 300))
  await waitUntil(false)
  console.log('MySQL 已停止')
}

async function init() {
  if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length > 0) {
    console.log('数据目录已存在，跳过初始化')
  } else {
    fs.mkdirSync(home, { recursive: true })
    console.log('初始化数据目录……')
    // root 账号不设密码：实例只监听 127.0.0.1，仅用于本机开发
    execFileSync(bin('mysqld'), ['--initialize-insecure', `--datadir=${dataDir}`, `--log-error=${logFile}`], {
      stdio: 'inherit',
    })
  }

  await start()

  const password = randomBytes(18).toString('base64url')
  const added = ensureEnv({
    NUXT_DATABASE_URL: `mysql://${DB_USER}:${password}@127.0.0.1:${PORT}/${DB_NAME}`,
    NUXT_SESSION_PASSWORD: randomBytes(32).toString('base64url'),
  })
  process.loadEnvFile(envFile)
  const url = new URL(process.env.NUXT_DATABASE_URL)
  const appPassword = decodeURIComponent(url.password)

  sql(
    [
      `CREATE DATABASE IF NOT EXISTS ${DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      `CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${appPassword}'`,
      `ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${appPassword}'`,
      `GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'127.0.0.1'`,
    ].join('; '),
  )
  console.log(`数据库 ${DB_NAME} 已就绪${added ? '，连接信息已写入 .env' : ''}`)
}

async function status() {
  console.log((await isRunning()) ? `运行中：127.0.0.1:${PORT}` : '未运行')
}

const commands = { init, start, stop, status }
const command = commands[process.argv[2]]
if (!command) {
  console.log('用法：node scripts/mysql.mjs <init|start|stop|status>')
  process.exit(1)
}
await command()
