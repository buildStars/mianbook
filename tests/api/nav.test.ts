import { describe, expect, it } from 'vitest'
import { Client } from './helpers'

describe('导航和个人中心', () => {
  it('页头有"题库"和"我的"两个下拉按钮，复习、模拟面试、问手册直接显示；页脚能到个人中心和收藏', async () => {
    const html = await (await new Client().request('/')).text()
    expect(html).toMatch(/<button[^>]*class="lib-btn[^"]*"[^>]*aria-expanded="false"[^>]*aria-controls="library-menu"/)
    expect(html).toMatch(/<button[^>]*class="acct-btn[^"]*"[^>]*aria-expanded="false"[^>]*aria-controls="account-menu"/)
    for (const href of ['/review', '/mock', '/ask']) expect(html).toContain(`href="${href}"`)
    for (const href of ['/me', '/favorites']) expect(html).toContain(`href="${href}"`)
    // 手机底部"我的"去个人中心
    expect(html).toMatch(/<nav class="tab-bar"[\s\S]*?href="\/me"[\s\S]*?我的/)
  })

  it('个人中心未登录也能打开：提示登录，列出全部个人入口；不让搜索引擎收录', async () => {
    const res = await new Client().request('/me')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    const html = await res.text()
    expect(html).toContain('<title>个人中心 | 面书</title>')
    expect(html).toContain('还没有登录')
    expect(html).toContain('href="/login?redirect=/me"')
    for (const href of ['/progress', '/favorites', '/favorites?tab=notes', '/review', '/report', '/mock', '/ask', '/connect']) {
      expect(html).toContain(`href="${href}"`)
    }
    expect(html).not.toContain('退出登录')
  })

  it('登录后个人中心显示名字、邮箱和退出登录；只有管理员有管理后台', async () => {
    const c = new Client()
    const user = await c.register('mecenter')
    const html = await (await c.request('/me')).text()
    expect(html).toContain(user.email)
    expect(html).toContain('退出登录')
    expect(html).not.toContain('还没有登录')
    // 测试库里第一个注册的账号会成为管理员
    expect(html.includes('href="/admin"')).toBe(user.role === 'admin')
  })

  it('收藏页和笔记页：标题跟着标签走，不让搜索引擎收录', async () => {
    const c = new Client()
    const stars = await c.request('/favorites')
    expect(stars.status).toBe(200)
    expect(stars.headers.get('x-robots-tag')).toBe('noindex')
    expect(await stars.text()).toContain('<title>我的收藏 | 面书</title>')
    const notes = await (await c.request('/favorites?tab=notes')).text()
    expect(notes).toContain('<title>我的笔记 | 面书</title>')
    expect(notes).toMatch(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?笔记/)
  })
})
