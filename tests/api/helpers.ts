import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { inject } from 'vitest'
import mysql from 'mysql2/promise'

export const baseUrl = () => inject('baseUrl')

export const randomEmail = (prefix = 'user') => `${prefix}-${crypto.randomBytes(4).toString('hex')}@example.test`

/** 随机的内网 IP，通过 X-Forwarded-For 传给服务（测试服务开着 trustProxy） */
export const randomIp = () => `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(1, 255)}`

/** 发件箱里最近发给这个邮箱的邮件 */
export function latestMail(email: string): { to: string; subject: string; text: string; html?: string } {
  const dir = inject('outboxDir')
  const suffix = `-${email.replace(/[^\w.@-]/g, '_')}.json`
  const name = fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).sort().at(-1)
  if (!name) throw new Error(`发件箱里没有发给 ${email} 的邮件`)
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
}

/** 最近发给这个邮箱的验证码 */
export function latestCode(email: string): string {
  const code = latestMail(email).subject.match(/^(\d{6}) /)?.[1]
  if (!code) throw new Error(`邮件里没有验证码：${email}`)
  return code
}

/** 带 cookie 的客户端，一个实例相当于一个登录的浏览器；每个实例有自己的 IP */
export class Client {
  cookie = ''
  ip = randomIp()

  async request(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const res = await fetch(baseUrl() + path, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': this.ip,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]!
    return res
  }

  async json<T = any>(path: string, options: Parameters<Client['request']>[1] = {}): Promise<{ status: number; data: T }> {
    const res = await this.request(path, options)
    return { status: res.status, data: (await res.json().catch(() => null)) as T }
  }

  /** 调用 SSE 接口，收集全部事件 */
  async sse(path: string, body: unknown, headers: Record<string, string> = {}) {
    const res = await this.request(path, { method: 'POST', body, headers })
    if (!(res.headers.get('content-type') ?? '').includes('event-stream')) {
      return { status: res.status, events: [], done: null, error: (await res.json().catch(() => null)) as any, text: '' }
    }
    const raw = await res.text()
    const events = raw
      .split('\n\n')
      .filter(Boolean)
      .map((block) => ({
        event: block.match(/^event: (.*)$/m)?.[1] ?? 'message',
        data: JSON.parse(block.match(/^data: (.*)$/m)?.[1] ?? 'null'),
      }))
    const text = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')
    return {
      status: res.status,
      events,
      text,
      done: events.find((e) => e.event === 'done')?.data ?? null,
      error: events.find((e) => e.event === 'error')?.data ?? null,
    }
  }

  /** 申请注册验证码 */
  requestCode(email: string) {
    return this.json('/api/auth/email-code', { body: { email, purpose: 'register' } })
  }

  /** 注册一个新用户并保持登录；邮箱随机，测试之间互不影响。站点要求验证码时先从发件箱取验证码 */
  async register(prefix = 'user') {
    const email = randomEmail(prefix)
    const sent = await this.requestCode(email)
    if (sent.status !== 200 && sent.status !== 400) throw new Error(`发验证码失败：${sent.status} ${JSON.stringify(sent.data)}`)
    const code = sent.status === 200 ? latestCode(email) : undefined
    const { status, data } = await this.json('/api/auth/register', {
      body: { email, name: prefix, password: crypto.randomBytes(12).toString('hex'), code },
    })
    if (status !== 200) throw new Error(`注册失败：${status} ${JSON.stringify(data)}`)
    return data as { id: number; email: string; role: 'admin' | 'user' }
  }

  answer(body: { questionId?: number; sessionId?: number; interviewId?: number; answer: string }) {
    return this.sse('/api/interviews/stream', body)
  }
}

let pool: mysql.Pool | undefined
/** 直接访问测试库，用来构造数据（比如把复习时间改到过去） */
export function db() {
  pool ??= mysql.createPool({ uri: inject('dbUrl'), connectionLimit: 2 })
  return pool
}

export async function questionId(slug: string, category: string): Promise<number> {
  const [rows] = await db().query<any[]>(
    'SELECT q.id FROM questions q JOIN categories c ON c.id = q.category_id WHERE q.slug = ? AND c.slug = ?',
    [slug, category],
  )
  if (!rows[0]) throw new Error(`测试库里没有题目 ${category}/${slug}`)
  return rows[0].id
}

/** 模拟大模型最近收到的请求 */
export async function lastLlmRequest() {
  const url = new URL(inject('mockUrl'))
  return (await fetch(`${url.origin}/__last`)).json()
}
