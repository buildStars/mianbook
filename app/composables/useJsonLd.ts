import type { MaybeRefOrGetter } from 'vue'

/**
 * 输出结构化数据（JSON-LD），帮助搜索引擎理解页面是什么。
 * < 转义成 <，避免题目里的字符提前结束 <script>；数据为空时不输出
 */
export function useJsonLd(data: MaybeRefOrGetter<object | object[] | null | undefined>) {
  const json = computed(() => {
    const value = toValue(data)
    return value ? JSON.stringify(value).replace(/</g, '\\u003c') : ''
  })
  useHead({
    script: computed(() => (json.value ? [{ type: 'application/ld+json', innerHTML: json.value }] : [])),
  })
}

/**
 * 站点作为作者和发布方：题目页、首页的结构化数据共用。
 * 配置要在 setup 里取好再传进来，计算属性里调用 useRuntimeConfig 在客户端会拿不到 Nuxt 实例
 */
export function siteOrganization({ siteName, siteUrl }: { siteName: string; siteUrl: string }) {
  return {
    '@type': 'Organization',
    name: siteName,
    url: `${siteUrl}/`,
    logo: { '@type': 'ImageObject', url: `${siteUrl}/icon-512.png`, width: 512, height: 512 },
  }
}
