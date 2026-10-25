/**
 * 哪些题的代码块能在浏览器里直接运行：手写题都是能独立运行的 JavaScript。
 * 其他分类的代码多是 Node、Vue、React 片段，离开项目跑不起来，先不开
 */
export const RUNNABLE_CATEGORIES = new Set(['handwriting'])

/** 能运行的代码块语言（Markdown 代码块上写的语言名） */
export const RUNNABLE_LANGS = new Set(['js', 'javascript', 'mjs'])

/** 沙箱带来的限制，报错后面补一句说明 */
export function explainRunError(text: string) {
  if (text.startsWith('SecurityError')) return `${text}（运行环境是隔离的沙箱，访问嵌套 iframe 这类跨页面的操作会被浏览器拦下）`
  if (/Failed to fetch|NetworkError|Content Security Policy/.test(text)) return `${text}（运行环境不能联网）`
  if (/^ReferenceError: (fs|require|process|module|Buffer|__dirname|__filename) is not defined/.test(text)) {
    return `${text}（这是 Node.js 的写法，浏览器里没有 fs、require、process 这些）`
  }
  return text
}
