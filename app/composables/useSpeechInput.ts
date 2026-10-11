/**
 * 浏览器语音识别（Web Speech API），把口述转成文字。
 * 目前 Chrome、Edge 等基于 Chromium 的浏览器支持，识别由浏览器厂商的在线服务完成；Firefox 不支持。
 * 需要 https 或 localhost 才能使用麦克风
 */
export function useSpeechInput(onFinal: (text: string) => void) {
  const supported = ref(false)
  const listening = ref(false)
  /** 正在识别、还没确定的文字 */
  const interim = ref('')
  const error = ref('')
  /** 本次说了多少秒，练习控制回答时长 */
  const seconds = ref(0)

  let recognition: any = null
  let keepOn = false
  let timer: ReturnType<typeof setInterval> | undefined

  const Ctor = () => (import.meta.client ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : undefined)
  onMounted(() => (supported.value = Boolean(Ctor())))

  const MESSAGES: Record<string, string> = {
    'not-allowed': '没有麦克风权限，请在浏览器地址栏旁边允许使用麦克风',
    'service-not-allowed': '浏览器不允许使用语音识别服务',
    'audio-capture': '没有检测到麦克风',
    network: '语音识别服务连不上。Chrome 用的是 Google 的在线服务，网络不通时可以换 Edge 试试',
    'language-not-supported': '浏览器不支持中文语音识别',
  }

  function finish() {
    listening.value = false
    interim.value = ''
    clearInterval(timer)
  }

  function start() {
    const SR = Ctor()
    if (!SR || listening.value) return
    recognition = new SR()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (e: any) => {
      let pending = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (result.isFinal) onFinal(result[0].transcript)
        else pending += result[0].transcript
      }
      interim.value = pending
    }
    recognition.onerror = (e: any) => {
      // 一段时间没说话、主动停止都会触发 error，这两种不提示
      if (e.error === 'no-speech' || e.error === 'aborted') return
      error.value = MESSAGES[e.error] ?? `语音识别出错（${e.error}）`
      keepOn = false
    }
    // 浏览器会在静音一段时间后自动结束识别，用户没点停止就重新开始
    recognition.onend = () => {
      if (keepOn) {
        try {
          recognition.start()
          return
        } catch {
          keepOn = false
        }
      }
      finish()
    }

    error.value = ''
    interim.value = ''
    seconds.value = 0
    keepOn = true
    try {
      recognition.start()
    } catch {
      error.value = '无法启动语音识别'
      keepOn = false
      return
    }
    listening.value = true
    timer = setInterval(() => seconds.value++, 1000)
  }

  function stop() {
    keepOn = false
    recognition?.stop()
  }

  const toggle = () => (listening.value ? stop() : start())

  onBeforeUnmount(() => {
    keepOn = false
    recognition?.abort()
    clearInterval(timer)
  })

  return { supported, listening, interim, error, seconds, start, stop, toggle }
}
