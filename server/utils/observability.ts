/** 可观测的统计：纯函数，方便单元测试 */
import type { AiKind, AiPerfRow } from '#shared/types/admin'

/** 线性插值的分位数（p 取 0～1）；没有数据时返回 null */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo))
}

export interface AiCallSample {
  kind: string
  status: 'ok' | 'aborted' | 'error'
  ttftMs: number | null
  latencyMs: number | null
}

function summarize(kind: AiKind | 'all', rows: AiCallSample[]): AiPerfRow {
  // 延迟只看正常结束的调用：出错和中途停止的耗时没有可比性
  const ok = rows.filter((r) => r.status === 'ok')
  const ttft = ok.map((r) => r.ttftMs).filter((v): v is number => v !== null)
  const latency = ok.map((r) => r.latencyMs).filter((v): v is number => v !== null)
  const errors = rows.filter((r) => r.status === 'error').length
  return {
    kind,
    calls: rows.length,
    errors,
    aborted: rows.filter((r) => r.status === 'aborted').length,
    errorRate: rows.length ? Math.round((errors / rows.length) * 1000) / 1000 : 0,
    ttftP50: percentile(ttft, 0.5),
    ttftP95: percentile(ttft, 0.95),
    latencyP50: percentile(latency, 0.5),
    latencyP95: percentile(latency, 0.95),
  }
}

/** 按功能汇总调用次数、出错率和首字延迟、总耗时的 P50/P95；用自己 Key 的（xxx-own）算进同一个功能 */
export function aiPerformance(rows: AiCallSample[], kinds: AiKind[]): { byKind: AiPerfRow[]; overall: AiPerfRow } {
  const byKind = kinds
    .map((kind) => summarize(kind, rows.filter((r) => r.kind.replace(/-own$/, '') === kind)))
    .filter((r) => r.calls > 0)
  return { byKind, overall: summarize('all', rows) }
}
