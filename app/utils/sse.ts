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
