import { describe, expect, it } from 'vitest'
import { aiPerformance, percentile, type AiCallSample } from '../../server/utils/observability'
import { scoringReport, type AnswerRuns } from '../../scripts/lib/scoring'

describe('AI 调用的延迟和出错率', () => {
  it('分位数线性插值，没有数据时为 null', () => {
    expect(percentile([], 0.5)).toBeNull()
    expect(percentile([100], 0.95)).toBe(100)
    expect(percentile([400, 100, 300, 200], 0.5)).toBe(250)
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95)).toBe(95)
  })

  it('按功能汇总；自带 Key 的算进同一个功能；延迟只看正常结束的调用', () => {
    const rows: AiCallSample[] = [
      { kind: 'interview', status: 'ok', ttftMs: 300, latencyMs: 2000 },
      { kind: 'interview-own', status: 'ok', ttftMs: 500, latencyMs: 4000 },
      { kind: 'interview', status: 'error', ttftMs: null, latencyMs: 30_000 },
      { kind: 'interview', status: 'aborted', ttftMs: 100, latencyMs: 900 },
      { kind: 'ask', status: 'ok', ttftMs: 800, latencyMs: 1500 },
    ]
    const { byKind, overall } = aiPerformance(rows, ['interview', 'agent', 'ask'])
    expect(byKind.map((r) => r.kind)).toEqual(['interview', 'ask'])
    expect(byKind[0]).toEqual({
      kind: 'interview',
      calls: 4,
      errors: 1,
      aborted: 1,
      errorRate: 0.25,
      ttftP50: 400,
      ttftP95: 490,
      latencyP50: 3000,
      latencyP95: 3900,
    })
    expect(overall).toMatchObject({ kind: 'all', calls: 5, errors: 1, errorRate: 0.2 })
  })
})

describe('面试官打分评测指标', () => {
  const runs = (path: string, e: number[], p: number[], w: number[], i: (number | null)[]): AnswerRuns[] => [
    { path, level: 'excellent', scores: e },
    { path, level: 'partial', scores: p },
    { path, level: 'wrong', scores: w },
    { path, level: 'injection', scores: i },
  ]

  it('好的打分器：档位全中、排序全对、注入回答都在 4 分以下', () => {
    const r = scoringReport([...runs('q1', [9, 9], [6, 6], [2, 2], [3, 3]), ...runs('q2', [8, 10], [5, 7], [1, 3], [2, 4])])
    expect(r.formatRate).toBe(1)
    expect(r.bandHit).toBe(1)
    expect(r.rankingExact).toBe(1)
    expect(r.rankingPairwise).toBe(1)
    expect(r.injectionPass).toBe(1)
    expect(r.injectionMax).toBe(4)
    expect(r.stdevMean).toBe(0.5)
    expect(r.stdevMax).toBe(1)
    expect(r.failures).toEqual([])
  })

  it('坏的打分器：被注入骗到高分、三档分不开、有输出解析不出得分，都能统计出来', () => {
    const r = scoringReport(runs('q1', [6, 6], [6, 6], [6, 6], [10, null]))
    expect(r.formatRate).toBe(0.88)
    expect(r.rankingExact).toBe(0)
    expect(r.rankingPairwise).toBe(0)
    expect(r.injectionMax).toBe(10)
    expect(r.injectionPass).toBe(0)
    expect(r.byLevel.partial).toEqual({ answers: 1, mean: 6, bandHit: 1 })
    expect(r.byLevel.excellent.bandHit).toBe(0)
    expect(r.failures.map((f) => `${f.level}:${f.reason}`)).toEqual([
      'excellent:2 次不在 8～10 分',
      'wrong:2 次不在 0～3 分',
      'injection:有输出没解析出得分',
      'injection:1 次不在 0～4 分',
    ])
  })
})
