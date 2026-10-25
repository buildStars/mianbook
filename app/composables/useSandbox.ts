import type { PracticeTestResult } from '#shared/types/practice'

export interface SandboxHandlers {
  log?: (level: 'log' | 'info' | 'warn' | 'error' | 'result', text: string) => void
  /** 运行页报的行号是整段代码里的行号 */
  error?: (message: string, line: number | null) => void
  test?: (result: PracticeTestResult | { done: true; passed: number; total: number }) => void
  clear?: () => void
  /** 代码执行完、也没有待执行的定时器了；dom 不为空说明代码往页面上放了东西，iframe 可以留着当预览 */
  idle?: (dom: { height: number } | null) => void
  resize?: (height: number) => void
  /** 超时，iframe 已经删掉 */
  timeout?: () => void
}

/**
 * 在沙箱 iframe（/sandbox/runner，见 server/utils/code-runner-page.ts）里执行准备好的代码，运行页发回来的消息交给回调。
 * 每次 run 都新开一个 iframe（sandbox="allow-scripts"：独立的源，碰不到站点的 Cookie 和页面）；
 * stop 删掉 iframe，里面的定时器也就停了。组件卸载时自动 stop
 */
export function useSandbox() {
  let frame: HTMLIFrameElement | null = null
  let listener: ((e: MessageEvent) => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  let started = 0

  function stop() {
    clearTimeout(timer)
    if (listener) window.removeEventListener('message', listener)
    listener = null
    frame?.remove()
    frame = null
  }

  /** 运行结束但要留着 iframe（页面预览里的按钮还能点）：只取消超时 */
  const settle = () => clearTimeout(timer)

  /** 从运行页准备好到现在的毫秒数 */
  const elapsed = () => Math.round(performance.now() - started)

  function run(source: string, container: HTMLElement, handlers: SandboxHandlers, timeout = 10_000) {
    stop()
    const id = ++seq
    const f = document.createElement('iframe')
    f.setAttribute('sandbox', 'allow-scripts')
    f.setAttribute('title', '代码运行结果的页面预览')
    f.className = 'code-frame'
    f.src = '/sandbox/runner'
    listener = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || e.data?.source !== 'mianbook-runner') return
      const { type, data, runId } = e.data
      if (type === 'ready') {
        started = performance.now()
        f.contentWindow!.postMessage({ type: 'run', runId: id, code: source }, '*')
        return
      }
      if (runId !== id) return
      if (type === 'log') handlers.log?.(data.level, data.text)
      else if (type === 'error') handlers.error?.(data.message, data.line ?? null)
      else if (type === 'test') handlers.test?.(data)
      else if (type === 'clear') handlers.clear?.()
      else if (type === 'idle') handlers.idle?.(data.dom)
      else if (type === 'resize') handlers.resize?.(data.height)
    }
    window.addEventListener('message', listener)
    frame = f
    container.appendChild(f)
    timer = setTimeout(() => {
      stop()
      handlers.timeout?.()
    }, timeout)
  }

  onBeforeUnmount(stop)
  return { run, stop, settle, elapsed }
}
