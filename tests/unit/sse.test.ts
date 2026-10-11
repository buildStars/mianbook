import { describe, expect, it } from 'vitest'
import { readSSE } from '../../app/utils/sse'

/** 把字符串按给定的块切开，模拟网络把数据切成任意大小 */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
}

async function collect(chunks: string[]) {
  const events = []
  for await (const ev of readSSE(streamOf(chunks))) events.push(ev)
  return events
}

describe('readSSE：解析服务端事件流', () => {
  it('事件被切在任意位置也能拼出来', async () => {
    const raw = 'event: delta\ndata: {"text":"你好"}\n\nevent: done\ndata: {"score":8}\n\n'
    const chunks = raw.match(/[\s\S]{1,5}/g)!
    expect(await collect(chunks)).toEqual([
      { event: 'delta', data: '{"text":"你好"}' },
      { event: 'done', data: '{"score":8}' },
    ])
  })

  it('多字节字符被切成两半时不会乱码', async () => {
    const bytes = new TextEncoder().encode('data: 面试\n\n')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 7))
        controller.enqueue(bytes.slice(7))
        controller.close()
      },
    })
    const events = []
    for await (const ev of readSSE(stream)) events.push(ev)
    expect(events).toEqual([{ event: 'message', data: '面试' }])
  })

  it('支持 CRLF 换行和多行 data', async () => {
    expect(await collect(['event: delta\r\ndata: 第一行\r\ndata: 第二行\r\n\r\n'])).toEqual([{ event: 'delta', data: '第一行\n第二行' }])
  })

  it('没有 data 的事件和注释行被忽略', async () => {
    expect(await collect([': ping\n\nevent: x\n\ndata: ok\n\n'])).toEqual([{ event: 'message', data: 'ok' }])
  })
})
