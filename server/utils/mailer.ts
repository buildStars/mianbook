import fs from 'node:fs'
import path from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

function mailOptions() {
  const { mail } = useRuntimeConfig()
  return {
    host: String(mail.host || ''),
    port: Number(mail.port) || 465,
    user: String(mail.user || ''),
    pass: String(mail.pass || ''),
    from: String(mail.from || mail.user || ''),
    outboxDir: String(mail.outboxDir || ''),
  }
}

/** 能不能发信：配置了 SMTP，或者配置了本地发件箱目录（开发和测试用） */
export function mailConfigured(): boolean {
  const o = mailOptions()
  return Boolean(o.outboxDir || (o.host && o.user && o.pass))
}

/** 给后台显示的发信状态，不包含密码 */
export function mailStatus() {
  const o = mailOptions()
  return {
    configured: mailConfigured(),
    mode: o.outboxDir ? ('outbox' as const) : o.host ? ('smtp' as const) : ('none' as const),
    host: o.host,
    from: o.from,
  }
}

let transporter: Transporter | null = null
let transporterKey = ''

function smtp(): Transporter {
  const o = mailOptions()
  const key = `${o.host}:${o.port}:${o.user}`
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: o.host,
      port: o.port,
      // 465 是 SSL 直连；587 等端口先明文连接再升级到 TLS
      secure: o.port === 465,
      auth: { user: o.user, pass: o.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
    transporterKey = key
  }
  return transporter
}

export class MailError extends Error {
  /** 服务商返回的具体原因，只给管理员看 */
  constructor(message: string, public detail = '') {
    super(message)
  }
}

export async function sendMail(message: MailMessage): Promise<void> {
  const o = mailOptions()
  if (o.outboxDir) {
    // 开发和测试：不发信，写成 JSON 文件，文件名里带收件人方便查找
    const dir = path.resolve(o.outboxDir)
    fs.mkdirSync(dir, { recursive: true })
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${message.to.replace(/[^\w.@-]/g, '_')}.json`
    fs.writeFileSync(path.join(dir, name), JSON.stringify({ from: o.from, ...message }, null, 2))
    return
  }
  if (!mailConfigured()) throw new MailError('站点还没有配置发信邮箱')
  try {
    await smtp().sendMail({ from: o.from, to: message.to, subject: message.subject, text: message.text, html: message.html })
  } catch (error) {
    // 具体原因（认证失败、连接超时）只记日志，不返回给用户
    console.error('[mail] 发送失败', error)
    throw new MailError('邮件发送失败，请稍后再试', error instanceof Error ? error.message.slice(0, 200) : '')
  }
}
