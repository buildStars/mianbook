import type { OutlinePart } from '#shared/types/handbook'

/**
 * 全站目录（几百道题的标题和路径）不放进每个页面的 payload，否则每个页面都要多带一百多 KB：
 * - 服务端渲染时直接取目录，payload 里只放内容版本号
 * - 浏览器在水合前按版本号请求 /api/outline?v=…（<head> 里提前预加载）。这个地址永久缓存，
 *   换页、再次访问都不用重新下载；拿到的和服务端渲染用的是同一份，水合不会对不上
 * - 后台改题后调用 refreshNuxtData('outline') 会重新拉最新目录
 */
export default defineNuxtPlugin({
  name: 'outline',
  async setup(nuxtApp) {
    const version = useState('outline-version', () => '')
    const outline = shallowRef<OutlinePart[]>([])

    async function load(v?: string) {
      const res = await $fetch.raw<OutlinePart[]>('/api/outline', { query: v ? { v } : undefined })
      outline.value = res._data ?? []
      version.value = res.headers.get('x-outline-version') ?? ''
    }

    if (import.meta.server) {
      await load()
      useHead({
        link: [{ rel: 'preload', as: 'fetch', href: `/api/outline?v=${version.value}`, crossorigin: 'anonymous' }],
      })
    } else {
      try {
        await load(version.value)
      } catch (error) {
        console.error('目录加载失败', error)
      }
    }

    nuxtApp.hook('app:data:refresh', async (keys) => {
      if (!keys || keys.includes('outline')) await load()
    })

    return { provide: { outline } }
  },
})
