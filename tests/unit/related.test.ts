import { describe, expect, it } from 'vitest'
import { dotProduct } from '../../server/utils/rag-core'
import { meanVector, pickRelated, rankByChunkHits } from '../../server/utils/related-core'

describe('相关题目', () => {
  it('题目向量是分块向量的平均再归一化', () => {
    const v = meanVector([new Float32Array([1, 0]), new Float32Array([0, 1])])!
    expect(v[0]).toBeCloseTo(Math.SQRT1_2)
    expect(v[1]).toBeCloseTo(Math.SQRT1_2)
    expect(dotProduct(v, v)).toBeCloseTo(1)
    expect(meanVector([])).toBeNull()
  })

  // 题目 1～4 在分类 10，5～8 在分类 20；9 没发布（不在 categoryOf 里）
  const categoryOf = new Map([1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, id <= 4 ? 10 : 20]))

  it('两路排名融合：两路都靠前的排最前', () => {
    const picked = pickRelated([[5, 6, 7], [6, 5, 8]], { selfId: 1, exclude: new Set(), categoryOf, limit: 3 })
    expect(picked.slice(0, 2).sort()).toEqual([5, 6])
    expect(picked).toHaveLength(3)
  })

  it('跳过自己、上一题下一题和未发布的题', () => {
    const picked = pickRelated([[1, 9, 2, 5, 6]], { selfId: 1, exclude: new Set([2]), categoryOf, limit: 5 })
    expect(picked).toEqual([5, 6])
  })

  it('同分类最多 2 道，给跨分类的关联留位置', () => {
    const picked = pickRelated([[2, 3, 4, 5, 6, 7]], { selfId: 1, exclude: new Set(), categoryOf, limit: 5 })
    expect(picked).toEqual([2, 3, 5, 6, 7])
  })

  it('关键词命中按题汇总：每题取最高两块相加，跳过自己和代码块', () => {
    const hits = [
      { questionId: 5, heading: '详细解析', score: 10 },
      { questionId: 6, heading: '一句话回答', score: 8 },
      { questionId: 6, heading: '详细解析', score: 6 },
      { questionId: 6, heading: '易错点', score: 5 },
      { questionId: 1, heading: '详细解析', score: 20 },
      { questionId: 7, heading: '代码示例', score: 30 },
    ]
    // 6 两块相加 14 > 5 的 10；第三块不算；1 是自己，7 只在代码块里命中
    expect(rankByChunkHits(hits, 1)).toEqual([6, 5])
    expect(rankByChunkHits(hits, 1, 1)).toEqual([6])
  })

  it('只有一路排名（没有向量）时也能用', () => {
    expect(pickRelated([[], [7, 8]], { selfId: 1, exclude: new Set(), categoryOf })).toEqual([7, 8])
  })
})
