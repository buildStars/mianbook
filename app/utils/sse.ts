export interface SseEvent {
  event: string
  data: string
}

/** 解析 fetch 返回的 SSE 响应流。网络数据会被任意切块，所以按空行拼出完整事件后再产出 */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer = (buffer + value).replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        let event = 'message'
        const data: string[] = []
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        }
        if (data.length) yield { event, data: data.join('\n') }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * POST 一个返回 SSE 的接口，逐个回调事件。
 * 请求失败或收到 error 事件时抛出 Error，消息是服务端给的提示
 */
export async function postSSE(
  url: string,
  body: unknown,
  options: { headers?: Record<string, string>; signal?: AbortSignal },
  onEvent: (event: string, data: any) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message || `请求失败（${res.status}）`)
  }
  for await (const ev of readSSE(res.body)) {
    const data = JSON.parse(ev.data)
    if (ev.event === 'error') throw new Error(data.message)
    onEvent(ev.event, data)
  }
}
