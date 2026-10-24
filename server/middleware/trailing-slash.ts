/**
 * 结尾带斜杠的页面地址（/basics/vue/）301 到不带斜杠的版本，同一页面只留一个网址，收录不会被分成两份。
 * 接口和构建产物不管。只跳由字母、数字和 -._~% 组成的路径：开头连着两个斜杠或带反斜杠的地址
 * （//evil.com/、/\evil.com/）去掉结尾斜杠后会被浏览器当成别的网站，这样的地址一律不跳
 */
export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const i = event.path.indexOf('?')
  const pathname = i === -1 ? event.path : event.path.slice(0, i)
  if (!/^(\/[\w.~%-]+)+\/+$/.test(pathname) || pathname.startsWith('/api/') || pathname.startsWith('/_')) return
  return sendRedirect(event, pathname.replace(/\/+$/, '') + (i === -1 ? '' : event.path.slice(i)), 301)
})
