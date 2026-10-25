import { RUNNER_CSP, RUNNER_HTML } from '../../utils/code-runner-page'

/** 题目代码的运行页，只给题目页的沙箱 iframe 用，见 server/utils/code-runner-page.ts */
export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': RUNNER_CSP,
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'public, max-age=3600',
  })
  return RUNNER_HTML
})
