// 发布到服务器。配置在 .env.deploy（不提交）：
//   DEPLOY_HOST=ubuntu@1.2.3.4
//   DEPLOY_KEY=~/.ssh/xxx            SSH 私钥路径
//   DEPLOY_DOMAIN=example.com
// 用法：
//   npm run deploy                  发布当前提交（未提交的修改不会发布）
//   npm run deploy -- --import      同时把 content/ 的题目导入线上数据库（第一次部署时用）
//   npm run deploy:backup           在服务器上立即备份一次，并下载到本地 backups/
import { spawn, execFileSync } from 'node:child_process'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
try {
  process.loadEnvFile(path.join(root, '.env.deploy'))
} catch {
  console.error('没有找到 .env.deploy，请先填写 DEPLOY_HOST、DEPLOY_KEY、DEPLOY_DOMAIN')
  process.exit(1)
}
const host = process.env.DEPLOY_HOST
const key = process.env.DEPLOY_KEY?.replace(/^~(?=[/\\])/, os.homedir())
const domain = process.env.DEPLOY_DOMAIN
if (!host || !key || !domain) {
  console.error('.env.deploy 里缺少 DEPLOY_HOST、DEPLOY_KEY 或 DEPLOY_DOMAIN')
  process.exit(1)
}

const sshArgs = ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', host]
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

/** 在服务器上执行命令；input 是要通过标准输入传过去的流 */
function ssh(command, { input, output } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [...sshArgs, command], {
      stdio: [input ? 'pipe' : 'inherit', output ? 'pipe' : 'inherit', 'inherit'],
    })
    if (input) input.pipe(child.stdin)
    if (output) child.stdout.pipe(output)
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`服务器上的命令失败（退出码 ${code}）`))))
  })
}

async function deploy() {
  const dirty = git('status', '--porcelain')
  if (dirty) console.warn('注意：有未提交的修改，这些修改不会发布。\n')
  console.log(`发布 ${git('log', '-1', '--format=%h %s')} → ${domain}\n`)

  // 只上传 git 里已提交的文件
  const archive = spawn('git', ['archive', '--format=tar', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })
  await ssh(
    'set -e; sudo mkdir -p /opt/handbook; sudo chown "$(id -u):$(id -g)" /opt/handbook; cd /opt/handbook; ' +
      'rm -rf src.new; mkdir src.new; tar -x -C src.new; cp src.new/deploy/remote-deploy.sh .',
    { input: archive.stdout },
  )
  const importFlag = process.argv.includes('--import') ? ' --import' : ''
  await ssh(`bash /opt/handbook/remote-deploy.sh ${domain}${importFlag}`)

  // 证书要等域名解析到服务器后才能申请下来，Caddy 会自动重试
  const ip = host.split('@').pop()
  const resolved = await dns.resolve4(domain).catch(() => [])
  if (!resolved.includes(ip)) {
    console.warn(`\n注意：${domain} 还没有解析到 ${ip}（现在是 ${resolved.join(', ') || '没有记录'}），解析生效后 HTTPS 证书会自动申请。`)
  }
  console.log(`\n发布完成：https://${domain}`)
}

async function backup() {
  const dir = path.join(root, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `handbook-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.sql.gz`)
  const out = fs.createWriteStream(file)
  await ssh('cd /opt/handbook && ./backup.sh >&2 && cat "$(ls -t backups/handbook-*.sql.gz | head -1)"', { output: out })
  await new Promise((resolve) => out.close(resolve))
  console.log(`已下载到 ${path.relative(root, file)}（${(fs.statSync(file).size / 1024).toFixed(0)} KB）`)
}

const task = process.argv[2] === 'backup' ? backup : deploy
task().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
