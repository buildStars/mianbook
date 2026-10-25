/**
 * 哪些题的代码块能在浏览器里直接运行：手写题都是能独立运行的 JavaScript。
 * 其他分类的代码多是 Node、Vue、React 片段，离开项目跑不起来，先不开
 */
export const RUNNABLE_CATEGORIES = new Set(['handwriting'])

/** 能运行的代码块语言（Markdown 代码块上写的语言名） */
export const RUNNABLE_LANGS = new Set(['js', 'javascript', 'mjs'])
