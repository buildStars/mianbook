<script setup lang="ts">
/**
 * 面试官点评。模型按"### 答对的点 / 遗漏或不准确 / 改进建议 / 追问"输出（见 server/utils/interview.ts），
 * 这里按小节拆开，每节用自己的图标和颜色，一眼分清哪里对、哪里漏；格式不规范时整段照常渲染。
 * hideFollowUp：追问会在下一轮的气泡里再出现一次时，卡片里就不重复显示
 */
const props = defineProps<{ text: string; score?: number | null; streaming?: boolean; hideFollowUp?: boolean }>()

type Kind = 'ok' | 'miss' | 'tip' | 'follow' | 'other'
const KINDS: Record<string, Kind> = { 答对的点: 'ok', 遗漏或不准确: 'miss', 改进建议: 'tip', 追问: 'follow' }

const sections = computed(() => {
  // split 带捕获组：[标题前的内容, 标题 1, 正文 1, 标题 2, 正文 2, …]
  const parts = stripScoreLine(props.text).split(/^#{1,4}[ \t]*(.+?)[ \t]*$/m)
  const list: { kind: Kind; title: string; html: string }[] = []
  if (parts[0]!.trim()) list.push({ kind: 'other', title: '', html: renderAiMarkdown(parts[0]!.trim()) })
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i]!.replace(/[：:]$/, '')
    const body = (parts[i + 1] ?? '').trim()
    const kind = KINDS[title] ?? 'other'
    if (kind === 'follow' && (props.hideFollowUp || /^无[。.]?$/.test(body))) continue
    list.push({ kind, title, html: body ? renderAiMarkdown(body) : '' })
  }
  return list
})

const VERDICTS = { good: '答得好', ok: '基本答出', bad: '还需加强' } as const
const verdict = computed(() => {
  if (props.score == null) return null
  return props.score >= 8 ? 'good' : props.score >= 5 ? 'ok' : 'bad'
})
</script>

<template>
  <div class="feedback" :class="{ streaming }">
    <div class="head">
      <span class="who">面试官点评</span>
      <span v-if="!streaming" class="result">
        <span v-if="verdict" class="verdict" :class="verdict">{{ VERDICTS[verdict] }}</span>
        <InterviewScore :score="score ?? null" />
      </span>
      <span v-else class="typing">正在点评<span class="dots"><i /><i /><i /></span></span>
    </div>
    <div class="body">
      <section v-for="(s, i) in sections" :key="i" class="sec" :class="s.kind">
        <h3 v-if="s.title" class="sec-title">
          <span v-if="s.kind !== 'other'" class="sec-icon" aria-hidden="true">
            <svg v-if="s.kind === 'ok'" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg>
            <svg v-else-if="s.kind === 'miss'" viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><rect x="6.8" y="2.5" width="2.4" height="7.5" rx="1.2" /><circle cx="8" cy="12.8" r="1.4" /></svg>
            <svg v-else-if="s.kind === 'tip'" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9M8.5 4l4 4-4 4" /></svg>
            <svg v-else viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5.8 6a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4" /><path d="M8 13h.01" /></svg>
          </span>
          {{ s.title }}
        </h3>
        <!-- 已转义原始 HTML 并禁用图片，见 renderAiMarkdown -->
        <div class="sec-body" v-html="s.html" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.feedback {
  --sec: var(--c-text-3);
  margin-left: 42px;
  padding: 14px 18px 16px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--c-divider);
}

.who {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ai-text);
}

.result {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.result :deep(.score) {
  min-width: 60px;
  padding: 3px 12px;
  font-size: 15px;
}

.result :deep(.score strong) {
  font-family: var(--font-serif);
  font-size: 18px;
}

.verdict {
  font-size: 13px;
  font-weight: 600;
}

.verdict.good {
  color: var(--st-mastered-text);
}

.verdict.ok {
  color: var(--st-fuzzy-text);
}

.verdict.bad {
  color: var(--st-weak-text);
}

.body {
  font-size: 14px;
  line-height: 1.8;
}

.sec {
  margin-top: 12px;
}

.sec.ok {
  --sec: var(--st-mastered);
}

.sec.miss {
  --sec: var(--st-fuzzy);
}

.sec.tip {
  --sec: var(--c-brand);
}

.sec.follow {
  --sec: var(--ai-via);
}

.sec-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 700;
  color: var(--c-text-1);
}

.sec-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--sec);
  color: #fff;
}

.sec-body {
  padding-left: 26px;
}

.sec.other .sec-body {
  padding-left: 0;
}

.sec-body :deep(p),
.sec-body :deep(ul),
.sec-body :deep(ol) {
  margin: 4px 0;
}

/* 一层列表符号：颜色跟着小节走 */
.sec-body :deep(ul) {
  padding: 0;
  list-style: none;
}

.sec-body :deep(ul > li) {
  position: relative;
  padding-left: 14px;
}

.sec-body :deep(ul > li)::before {
  content: '';
  position: absolute;
  top: 0.78em;
  left: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sec);
}

.sec-body :deep(ol) {
  padding-left: 1.3em;
}

.sec-body :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--c-default-soft);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.sec-body :deep(pre) {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--c-code-bg);
  overflow-x: auto;
}

.sec-body :deep(pre code) {
  padding: 0;
  background: none;
}

.streaming .sec:last-child .sec-body > :deep(:last-child)::after {
  content: '▍';
  margin-left: 2px;
  color: var(--ai-via);
  animation: blink 1s steps(1) infinite;
}

.typing {
  font-size: 12px;
  color: var(--ai-text);
}

@media (max-width: 640px) {
  .feedback {
    margin-left: 0;
  }
}

.dots i {
  display: inline-block;
  width: 4px;
  height: 4px;
  margin-left: 3px;
  border-radius: 50%;
  background: currentColor;
  animation: bounce 1.2s infinite;
}

.dots i:nth-child(2) {
  animation-delay: 0.2s;
}

.dots i:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

@keyframes bounce {
  0%,
  80%,
  100% {
    opacity: 0.3;
  }
  40% {
    opacity: 1;
  }
}
</style>
