import { describe, expect, it } from 'vitest'
import type { IndexedChunk, RetrievalHit } from '../../server/utils/rag-core'
import { TALKCUE_MIN_SIMILARITY, talkcueAuthorized, talkcueHits } from '../../server/utils/talkcue'

const chunk = (id: number, title: string, path: string, heading = ''): IndexedChunk => ({
  id,
  questionId: id,
  title,
  path,
  category: 'JavaScript',
  heading,
  text: `${title} 的回答内容`,
  vector: null,
})

const hit = (c: IndexedChunk, similarity: number | null, fusedRank: number): RetrievalHit => ({
  chunk: c,
  score: 1 / (60 + fusedRank),
  keywordRank: fusedRank,
  vectorRank: similarity === null ? null : fusedRank,
  similarity,
  fusedRank,
  rerankScore: null,
})

describe('TalkCue 题库检索', () => {
  it('只认 Authorization: Bearer 加正确的令牌，没配置令牌时谁都不认', () => {
    expect(talkcueAuthorized('Bearer s3cret-token', 's3cret-token')).toBe(true)
    expect(talkcueAuthorized('bearer s3cret-token ', 's3cret-token')).toBe(true)
    expect(talkcueAuthorized('Bearer s3cret-tokeN', 's3cret-token')).toBe(false)
    expect(talkcueAuthorized('s3cret-token', 's3cret-token')).toBe(false)
    expect(talkcueAuthorized(undefined, 's3cret-token')).toBe(false)
    expect(talkcueAuthorized('Bearer ', '')).toBe(false)
  })

  it('只留相似度够高的块，按原顺序，带原题的绝对地址', () => {
    const hits = [
      hit(chunk(1, '说说浏览器的事件循环（Event Loop）', '/basics/javascript/01-event-loop', '宏任务和微任务'), 0.809, 1),
      hit(chunk(2, 'Node.js 的事件循环和浏览器有什么不同？', '/basics/node/03-event-loop'), 0.731, 2),
      // 只在关键词结果里：没有相似度，不算
      hit(chunk(3, '事件委托是什么？', '/basics/javascript/12-event-delegation'), null, 3),
      hit(chunk(4, '设计一个实时语音对话的 AI 助手', '/engineering/system-design/05-voice'), 0.599, 4),
    ]
    const out = talkcueHits(hits, 'https://mianbook.ink/', { limit: 4, minSimilarity: TALKCUE_MIN_SIMILARITY })
    expect(out).toEqual([
      {
        title: '说说浏览器的事件循环（Event Loop）',
        url: 'https://mianbook.ink/basics/javascript/01-event-loop',
        heading: '宏任务和微任务',
        text: '说说浏览器的事件循环（Event Loop） 的回答内容',
        similarity: 0.809,
      },
      expect.objectContaining({ url: 'https://mianbook.ink/basics/node/03-event-loop', similarity: 0.731 }),
    ])
    expect(talkcueHits(hits, 'https://mianbook.ink', { limit: 1, minSimilarity: 0.62 })).toHaveLength(1)
  })

  it('过了门槛、但比最相关的一块低 0.1 以上的弱相关题不要', () => {
    const hits = [
      hit(chunk(1, '说说浏览器的事件循环（Event Loop）', '/basics/javascript/01-event-loop'), 0.809, 1),
      hit(chunk(2, '事件流是什么？什么是事件委托？', '/basics/browser/04-event-delegation'), 0.672, 2),
      hit(chunk(3, '现代浏览器有哪些进程？', '/basics/browser/03-multi-process'), 0.65, 3),
      hit(chunk(4, '说说浏览器的事件循环（Event Loop）', '/basics/javascript/01-event-loop', '常见陷阱'), 0.72, 4),
    ]
    expect(talkcueHits(hits, 'https://mianbook.ink', { limit: 4, minSimilarity: TALKCUE_MIN_SIMILARITY }).map((h) => h.similarity)).toEqual([0.809, 0.72])
    // 最相关的也只是刚过门槛时，差距按它来算
    const close = [hit(chunk(5, 'a', '/a'), 0.66, 1), hit(chunk(6, 'b', '/b'), 0.63, 2)]
    expect(talkcueHits(close, 'https://mianbook.ink', { limit: 4, minSimilarity: TALKCUE_MIN_SIMILARITY })).toHaveLength(2)
    expect(talkcueHits(hits, 'https://mianbook.ink', { limit: 4, minSimilarity: 0.62, maxGap: 1 })).toHaveLength(4)
  })

  it('题库里没有的问题（最接近的也不够相关）返回空', () => {
    const hits = [hit(chunk(4, '设计一个实时语音对话的 AI 助手', '/engineering/system-design/05-voice'), 0.599, 1)]
    expect(talkcueHits(hits, 'https://mianbook.ink', { limit: 4, minSimilarity: TALKCUE_MIN_SIMILARITY })).toEqual([])
    expect(talkcueHits([], 'https://mianbook.ink', { limit: 4, minSimilarity: 0.62 })).toEqual([])
  })
})
