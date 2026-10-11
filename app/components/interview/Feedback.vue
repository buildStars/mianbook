<script setup lang="ts">
const props = defineProps<{ text: string; score?: number | null; streaming?: boolean }>()
const html = computed(() => renderAiMarkdown(stripScoreLine(props.text)))
</script>

<template>
  <div class="feedback" :class="{ streaming }">
    <div class="head">
      <span class="who">面试官点评</span>
      <InterviewScore v-if="!streaming" :score="score ?? null" />
      <span v-else class="typing">正在点评<span class="dots"><i /><i /><i /></span></span>
    </div>
    <!-- 已转义原始 HTML 并禁用图片，见 renderAiMarkdown -->
    <div class="body" v-html="html" />
  </div>
</template>

<style scoped>
.feedback {
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
  margin-bottom: 4px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--c-divider);
}

.who {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ai-text);
}

.body {
  font-size: 14px;
  line-height: 1.8;
}

.body :deep(h3) {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 4px;
  font-size: 14px;
  font-weight: 700;
  color: var(--c-text-1);
}

.body :deep(h3)::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: var(--ai-via);
}

.body :deep(p),
.body :deep(ul),
.body :deep(ol) {
  margin: 4px 0;
}

.body :deep(ul),
.body :deep(ol) {
  padding-left: 1.2em;
}

.body :deep(ul) {
  list-style: disc;
}

.body :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--c-default-soft);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.body :deep(pre) {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--c-code-bg);
  overflow-x: auto;
}

.body :deep(pre code) {
  padding: 0;
  background: none;
}

.streaming .body > :deep(:last-child)::after {
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
