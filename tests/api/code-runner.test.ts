import { describe, expect, it } from 'vitest'
import { baseUrl } from './helpers'

describe('手写题代码运行页', () => {
  it('运行页禁止联网、不让搜索引擎收录，带着运行要用的脚本', async () => {
    const res = await fetch(`${baseUrl()}/sandbox/runner`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toContain('connect-src')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    const html = await res.text()
    expect(html).toContain('<div id="app"></div>')
    expect(html).toContain('function formatValue(')
    expect(html).toContain("post('ready', null)")
  })

  it('robots.txt 不让抓运行页', async () => {
    const text = await (await fetch(`${baseUrl()}/robots.txt`)).text()
    expect(text).toContain('Disallow: /sandbox/')
  })
})
