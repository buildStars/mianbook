import crypto from 'node:crypto'
import type { RetrievalHit } from './rag-core'

/**
 * 给 TalkCue（面试提词助手）用的题库检索：面试中每听到一个问题，TalkCue 的服务端从内网来问
 * "题库里有没有能回答它的段落"，有就让回答优先依据这些段落，答案卡上链接到原题。
 *
 * 和问手册的区别是要判断"有没有"：问手册总是给出最接近的几段，面试里问到"你为什么离职"时，
 * 这些最接近的段落是错的，不能塞给模型。所以只返回和问题的向量相似度够高的块。
 * 门槛 0.62 是用线上数据校准的（692 道题、5947 块，bge-m3）：
 *   口语化的面试问题，命中正确题目时最低 0.647；evals/retrieval.json 的场景题 66 个命中里 60 个高于 0.62；
 *   自我介绍、离职原因、"能听到我说话吗"这类题库没有的问题，最高 0.599
 */
export const TALKCUE_MIN_SIMILARITY = 0.62

/** Authorization: Bearer <NUXT_TALKCUE_TOKEN>，定长比较 */
export function talkcueAuthorized(header: string | undefined, token: string): boolean {
  if (!token) return false
  const got = header?.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? ''
  const a = crypto.createHash('sha256').update(got).digest()
  const b = crypto.createHash('sha256').update(token).digest()
  return crypto.timingSafeEqual(a, b)
}

export interface TalkcueHit {
  /** 题目标题 */
  title: string
  /** 原题地址（绝对地址） */
  url: string
  /** 块所在的小节，没有为空 */
  heading: string
  text: string
  similarity: number
}

/**
 * 比最相关的一块低这么多的就不要了：问"浏览器的事件循环"时，事件委托、多进程这些题
 * 也过了 0.62，但明显不是在答这个问题，塞给模型只会分散注意力
 */
export const TALKCUE_MAX_GAP = 0.1

/**
 * 混合检索的结果里，只留和问题足够相关的块：不低于 minSimilarity，也不比最相关的一块低 maxGap 以上，
 * 按原来的顺序，最多 limit 块。只出现在关键词结果里、没有相似度的块不算：没有证据说明它真的在回答这个问题
 */
export function talkcueHits(
  hits: RetrievalHit[],
  siteUrl: string,
  options: { limit: number; minSimilarity: number; maxGap?: number },
): TalkcueHit[] {
  const base = siteUrl.replace(/\/+$/, '')
  const relevant = hits.filter((h) => h.similarity !== null && h.similarity >= options.minSimilarity)
  const best = Math.max(...relevant.map((h) => h.similarity!))
  const floor = best - (options.maxGap ?? TALKCUE_MAX_GAP)
  return relevant
    .filter((h) => h.similarity! >= floor)
    .slice(0, options.limit)
    .map((h) => ({
      title: h.chunk.title,
      url: `${base}${h.chunk.path}`,
      heading: h.chunk.heading,
      text: h.chunk.text,
      similarity: Math.round(h.similarity! * 1000) / 1000,
    }))
}
