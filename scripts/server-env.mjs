// 把发信邮箱、向量 Key 这类密钥写进服务器的 /opt/handbook/.env，然后重启应用。
// 用法：npm run server:env（要在能输入的终端里运行）
// 密钥在终端里输入、不回显，通过 SSH 的标准输入传给服务器，不出现在命令行参数和 shell 历史里。
// 已有的同名配置会被替换，直接回车表示这一项不改。服务器信息读 .env.deploy（和 npm run deploy 一样）
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { Writable } from 'node:stream'

const root = path.resolve(import.meta.dirname, '..')
try {
  process.loadEnvFile(path.join(root, '.env.deploy'))
} catch {
  console.error('没有找到 .env.deploy，请先填写 DEPLOY_HOST、DEPLOY_KEY')
  process.exit(1)
}
const host = process.env.DEPLOY_HOST
const key = process.env.DEPLOY_KEY?.replace(/^~(?=[/\\])/, os.homedir())
if (!host || !key) {
  console.error('.env.deploy 里缺少 DEPLOY_HOST 或 DEPLOY_KEY')
  process.exit(1)
}
if (!process.stdin.isTTY) {
  console.error('请在能输入的终端里运行（比如 PowerShell 或编辑器里的终端）')
  process.exit(1)
}

/** 问一个问题；hidden 时输入的内容不回显，回车后显示输入了几个字符，方便发现粘贴了两次 */
function ask(question, { hidden = false, fallback = '' } = {}) {
  const prompt = `${question}${fallback ? `（回车用 ${fallback}）` : '（回车跳过）'}：`
  return new Promise((resolve) => {
    // 隐藏输入时，readline 照常处理退格等按键，但它的输出（回显、清行、移动光标）都接到一个丢弃一切的流上，
    // 提示语由这里自己打印。不能只拦 _writeToOutput：readline 开始读之前会把光标移回行首并清行，会把提示语一起擦掉
    if (hidden) process.stdout.write(prompt)
    const output = hidden ? new Writable({ write: (_chunk, _encoding, done) => done() }) : process.stdout
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true, historySize: 0 })
    // 没回答就关闭了（Ctrl+C、Ctrl+D）：直接退出，这时还没往服务器写任何东西
    let answered = false
    rl.on('close', () => {
      if (answered) return
      process.stdout.write('\n已取消，服务器没有改动\n')
      process.exit(130)
    })
    rl.question(hidden ? '' : prompt, (answer) => {
      answered = true
      rl.close()
      const value = answer.trim()
      if (hidden) process.stdout.write(value ? `（已输入 ${value.length} 个字符）\n` : '\n')
      resolve(value || fallback)
    })
  })
}

const values = {}
console.log('发信邮箱（注册验证码、忘记密码用）')
const user = await ask('  邮箱地址，比如 12345@qq.com')
if (user) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) {
    console.error('邮箱格式不对')
    process.exit(1)
  }
  const domain = user.split('@')[1].toLowerCase()
  const guess = domain === 'qq.com' ? 'smtp.qq.com' : domain === '163.com' ? 'smtp.163.com' : `smtp.${domain}`
  const smtpHost = await ask('  SMTP 服务器', { fallback: guess })
  // QQ、163 邮箱的授权码都是 16 位；不是 16 位多半是粘贴了两次或少复制了几位
  const fixedLength = domain === 'qq.com' || domain === '163.com' ? 16 : 0
  let pass = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    pass = await ask('  授权码，只粘贴一次（输入时不显示）', { hidden: true })
    if (!pass) {
      console.error('没有填授权码')
      process.exit(1)
    }
    if (!fixedLength || pass.length === fixedLength) break
    console.log(`  ${domain} 的授权码是 ${fixedLength} 位，你输入了 ${pass.length} 位，可能粘贴了两次，请重新输入`)
    pass = ''
  }
  if (!pass) process.exit(1)
  Object.assign(values, {
    NUXT_MAIL_HOST: smtpHost,
    NUXT_MAIL_PORT: '465',
    NUXT_MAIL_USER: user,
    NUXT_MAIL_PASS: pass,
    NUXT_MAIL_FROM: `"面书 <${user}>"`,
  })
}

console.log('问手册的向量模型（硅基流动）')
const embed = await ask('  API Key，sk- 开头（输入时不显示）', { hidden: true })
if (embed) {
  if (!/^sk-[\w-]{10,}$/.test(embed)) {
    console.error('API Key 格式不对，应该是 sk- 开头')
    process.exit(1)
  }
  values.NUXT_EMBED_API_KEY = embed
}

if (!Object.keys(values).length) {
  console.log('什么都没填，不改动服务器')
  process.exit(0)
}
for (const v of Object.values(values)) {
  if (/[\r\n]/.test(v)) {
    console.error('输入里不能有换行')
    process.exit(1)
  }
}

// 服务器上：逐行替换同名配置（没有就追加），保持只有本人可读，再重建应用容器让新配置生效
const remote = [
  'set -e',
  'cd /opt/handbook',
  'umask 077',
  'tmp=$(mktemp)',
  'cat > "$tmp"',
  'while IFS= read -r line; do key="${line%%=*}"; grep -v "^${key}=" .env > .env.tmp || true; mv .env.tmp .env; printf "%s\\n" "$line" >> .env; done < "$tmp"',
  'rm -f "$tmp"',
  'chmod 600 .env',
  'docker compose up -d --force-recreate app',
].join('\n')

console.log(`\n写入 ${Object.keys(values).join('、')}，并重启应用…`)
const child = spawn('ssh', ['-i', key, '-o', 'BatchMode=yes', host, remote], { stdio: ['pipe', 'inherit', 'inherit'] })
child.stdin.end(`${Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n')}\n`)
child.on('exit', (code) => {
  if (code === 0) console.log('\n完成。到后台「用户」页点"发测试邮件给我"，到「知识库」页看向量生成进度')
  else console.error(`\n失败（退出码 ${code}），服务器上的配置可能没有改动`)
  process.exit(code ?? 1)
})
