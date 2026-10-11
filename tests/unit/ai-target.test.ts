import { describe, expect, it } from 'vitest'
import { AI_PROVIDERS } from '../../shared/utils/ai-providers'
import { parseUserTarget } from '../../server/utils/ai'

const hosts = AI_PROVIDERS.map((p) => new URL(p.baseUrl).hostname)
const ok = { apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
const errorOf = (input: Parameters<typeof parseUserTarget>[0], allowed = hosts) => {
  try {
    parseUserTarget(input, allowed)
  } catch (error: any) {
    return { status: error.statusCode, message: error.message as string }
  }
  return null
}

describe('用户自带 Key 的配置校验', () => {
  it('没填 Key 时用站点配置', () => {
    expect(parseUserTarget({ ...ok, apiKey: '  ' }, hosts)).toBeNull()
    expect(parseUserTarget({}, hosts)).toBeNull()
  })

  it('预设服务商通过，去掉末尾斜杠', () => {
    expect(parseUserTarget({ ...ok, baseUrl: 'https://api.deepseek.com/v1/' }, hosts)).toEqual({
      source: 'user',
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    })
  })

  it.each([
    ['http 明文', 'http://api.deepseek.com/v1'],
    ['本机地址', 'https://127.0.0.1/v1'],
    ['内网地址', 'https://10.0.0.8/v1'],
    ['不在白名单的域名', 'https://evil.example.com/v1'],
    ['白名单域名加端口', 'https://api.deepseek.com:8443/v1'],
    ['带用户名密码', 'https://user:pass@api.deepseek.com/v1'],
    ['白名单域名的子域名', 'https://api.deepseek.com.evil.example/v1'],
  ])('拒绝%s（防 SSRF）', (_, baseUrl) => {
    expect(errorOf({ ...ok, baseUrl })?.status).toBe(400)
  })

  it('格式不对的地址', () => {
    expect(errorOf({ ...ok, baseUrl: 'not a url' })?.message).toContain('格式不对')
  })

  it('管理员追加的域名可以用', () => {
    const target = parseUserTarget({ ...ok, baseUrl: 'https://llm.example.com/v1' }, [...hosts, 'llm.example.com'])
    expect(target?.baseUrl).toBe('https://llm.example.com/v1')
  })

  it.each(['', 'a b', 'x'.repeat(129), 'model;rm'])('拒绝不合法的模型名 %j', (model) => {
    expect(errorOf({ ...ok, model })?.message).toContain('模型名')
  })

  it('接受带斜杠和冒号的模型名', () => {
    expect(parseUserTarget({ ...ok, model: 'deepseek-ai/DeepSeek-V3:free' }, hosts)?.model).toBe('deepseek-ai/DeepSeek-V3:free')
  })

  it('拒绝带空白或过长的 Key', () => {
    expect(errorOf({ ...ok, apiKey: 'sk-a b' })?.message).toContain('API Key')
    expect(errorOf({ ...ok, apiKey: 'k'.repeat(513) })?.message).toContain('API Key')
  })
})
