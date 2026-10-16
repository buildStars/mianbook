/**
 * 选题雷达的纯函数：清理题目标题、从 Markdown 里提取问题、计算相似度、把不同说法的同一道题合并、猜分类。
 * scripts/topic-radar.ts 和单元测试共用
 */

/** 去掉编号前缀（"第 12 题："、"[js] 第3天"、"1. "）、Markdown 标记和多余空白 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(\[[^\]]{1,12}\]\s*)+/, '')
    .replace(/^\s*第\s*\d+\s*[题天期]\s*[:：.、]?\s*/, '')
    .replace(/^\s*(Q\s*)?\d+(\.\d+)*\s*[.、:：)）]\s*/i, '')
    .replace(/^\s*\d+\s+(?=[\p{Script=Han}A-Za-z])/u, '')
    // 开头的 ⭐️、▶ 之类的符号
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 离开正文就没有意义的标题，比如"写出下面代码的输出"，不参与统计 */
export function isNoise(text: string): boolean {
  return /(以下|如下|下面|下列|这段)的?(代码|程序)|(输出|打印|运行)(的)?结果|^实现(以下|如下|下面)/.test(text) || grams(text).size < 2
}

/** 去掉单个汉字的特征（"中""是"这类），判断正文有没有讲到某个话题时只看词 */
export const strongGrams = (g: Set<string>) => new Set([...g].filter((x) => x.startsWith('w:') || x.length >= 2))

/** 包含度：a 的特征有多少比例出现在 b 里（0～1），用来判断一段正文有没有讲到某个话题 */
export function containment(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0
  let common = 0
  for (const g of a) if (b.has(g)) common++
  return common / a.size
}

const QUESTION_WORDS = /[？?]|什么|如何|怎么|为什么|为何|区别|原理|实现|哪些|是否|能否|作用|优缺点|对比|理解|介绍/
const HAS_HAN = /\p{Script=Han}/u

/** 看起来像一道面试题：有中文、长度合适、带问号或疑问词 */
export function looksLikeQuestion(text: string): boolean {
  return text.length >= 6 && text.length <= 80 && HAS_HAN.test(text) && QUESTION_WORDS.test(text)
}

/** 从 Markdown 里提取问题：标题行、列表项（常见写法是 "- [问题](链接)"）；代码块里的不算 */
export function extractQuestions(markdown: string): string[] {
  const out: string[] = []
  let fence = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
    const item = heading ? null : line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/)
    if (!heading && !item) continue
    const text = cleanTitle((heading ?? item)![1]!)
    if (!looksLikeQuestion(text)) continue
    // 列表项常常是答案里的要点（"原子性：事务是……"），只收带问号、或者很短又像问题的
    if (item && !/[？?]/.test(text) && (text.length > 30 || /[：:]/.test(text))) continue
    out.push(text)
  }
  return [...new Set(out)]
}

/** 比较时忽略的口头词：同一道题常见的不同问法 */
const FILLER = [
  '请你', '请问', '说一说', '说说', '谈一谈', '谈谈', '讲一讲', '讲讲', '聊聊', '介绍一下', '简单介绍', '介绍', '简述', '描述一下', '描述',
  '你对', '你知道', '你了解', '你是怎么', '你会', '的理解', '是什么', '什么是', '有哪些', '有什么', '是怎样', '是怎么', '怎么样', '怎么', '如何',
  '为什么', '为何', '哪些', '什么', '一下', '分别', '具体', '吗', '呢', '吧', '的',
]
const FILLER_RE = new RegExp(FILLER.sort((a, b) => b.length - a.length).join('|'), 'g')

export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(FILLER_RE, ' ').replace(/[^\p{Script=Han}a-z0-9+#]+/gu, ' ').trim()
}

/** 特征：中文按相邻两个字，英文按整个单词（react、useeffect、b+） */
export function grams(text: string): Set<string> {
  const out = new Set<string>()
  const norm = normalizeForMatch(text)
  for (const word of norm.match(/[a-z0-9+#]+/g) ?? []) out.add(`w:${word}`)
  for (const run of norm.match(/\p{Script=Han}+/gu) ?? []) {
    if (run.length === 1) out.add(run)
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2))
  }
  return out
}

/** Dice 系数：2|A∩B| / (|A| + |B|)，0～1 */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let common = 0
  for (const g of a) if (b.has(g)) common++
  return (2 * common) / (a.size + b.size)
}

export interface RadarItem {
  text: string
  source: string
  url: string
}

export interface RadarCluster {
  /** 用最短的说法当代表 */
  title: string
  items: RadarItem[]
  /** 出现在几个不同的来源里，越多说明越常被问 */
  sources: number
}

/** 贪心合并：和已有某个话题的代表说法足够像就并进去，否则新开一个话题 */
export function clusterItems(items: RadarItem[], threshold = 0.6): RadarCluster[] {
  const clusters: { rep: Set<string>; title: string; items: RadarItem[] }[] = []
  const index = new Map<string, number[]>()
  for (const item of items) {
    const g = grams(item.text)
    if (!g.size) continue
    // 只和有共同特征的话题比较，避免两两全比
    const candidates = new Set<number>()
    for (const k of g) for (const i of index.get(k) ?? []) candidates.add(i)
    let best = -1
    let bestScore = threshold
    for (const i of candidates) {
      const s = similarity(g, clusters[i]!.rep)
      if (s >= bestScore) {
        best = i
        bestScore = s
      }
    }
    if (best >= 0) {
      const c = clusters[best]!
      c.items.push(item)
      if (item.text.length < c.title.length) c.title = item.text
    } else {
      clusters.push({ rep: g, title: item.text, items: [item] })
      for (const k of g) index.set(k, [...(index.get(k) ?? []), clusters.length - 1])
    }
  }
  return clusters
    .map((c) => ({ title: c.title, items: c.items, sources: new Set(c.items.map((i) => i.source)).size }))
    .sort((a, b) => b.sources - a.sources || b.items.length - a.items.length)
}

/** 关键词猜分类（题库的分类路径）；猜不出来时返回 null，由调用方用最接近的已有题的分类兜底 */
const RULES: [RegExp, string][] = [
  // ReAct 要区分大小写，不然 React 也会被当成 Agent
  [/\bReAct\b/, 'ai/agent'],
  [/智能体|agent|function ?call|工具调用|mcp/i, 'ai/agent'],
  [/rag|向量|embedding|召回|重排|知识库/i, 'ai/rag'],
  [/prompt|提示词|思维链|\bcot\b/i, 'ai/prompt'],
  [/大模型|llm|transformer|attention|注意力|微调|lora|rlhf|幻觉|预训练|tokenizer|强化学习|bert|gpt/i, 'ai/llm'],
  [/react|hooks?|jsx|fiber|usestate|useeffect|redux/i, 'basics/react'],
  [/vue|pinia|vuex|nuxt/i, 'basics/vue'],
  [/typescript|\bts\b|泛型|interface|装饰器/i, 'basics/typescript'],
  [/webpack|vite|babel|打包|构建|tree ?shaking|loader|plugin/i, 'basics/build'],
  [/css|flex|grid|bfc|盒模型|居中|选择器|样式|动画/i, 'basics/css'],
  [/html|语义化|无障碍|可访问|canvas|svg/i, 'basics/html'],
  [/xss|csrf|点击劫持|csp/i, 'basics/web-security'],
  [/浏览器|渲染|重排|重绘|跨域|cookie|localstorage|事件循环|event ?loop|dom/i, 'basics/browser'],
  [/https?|tcp|udp|dns|三次握手|四次挥手|websocket|网络|cdn|\barp\b|中间人|子网|ip 地址/i, 'basics/network'],
  [/node|express|koa|nest|libuv|npm|pnpm/i, 'basics/node'],
  [/promise|闭包|原型|this|async|await|防抖|节流|深拷贝|es6|javascript|\bjs\b|作用域|变量提升|事件委托|类数组/i, 'basics/javascript'],
  [/golang|goroutine|channel|gmp|defer|\bgo\b/i, 'basics/go'],
  [/java|jvm|spring|hashmap|线程池|synchronized|volatile|aqs|mybatis/i, 'basics/java'],
  [/redis|缓存穿透|缓存雪崩|缓存击穿|rdb|aof/i, 'basics/redis'],
  [/mysql|索引|事务|mvcc|innodb|sql|分库分表|b\+ ?树/i, 'basics/mysql'],
  [/kafka|rabbitmq|rocketmq|消息队列|\bmq\b|分布式|raft|cap|限流|熔断|一致性哈希/i, 'basics/distributed'],
  [/docker|k8s|kubernetes|容器|\bpod\b/i, 'basics/container'],
  [/linux|进程|线程|操作系统|死锁|epoll|多路复用|零拷贝|虚拟内存/i, 'basics/os'],
  [/设计模式|单例|工厂模式|观察者|策略模式|装饰器模式/i, 'basics/design-pattern'],
  [/算法|排序|链表|二叉树|动态规划|leetcode|复杂度|回溯|贪心/i, 'basics/algorithm'],
]

export function guessCategory(text: string): string | null {
  return RULES.find(([re]) => re.test(text))?.[1] ?? null
}
