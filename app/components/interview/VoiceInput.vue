<script setup lang="ts">
/** 语音作答按钮：识别出的文字追加到回答末尾；浏览器不支持时不显示 */
const model = defineModel<string>({ required: true })
const props = defineProps<{ disabled?: boolean; maxlength?: number }>()

const { supported, listening, interim, error, seconds, toggle, stop } = useSpeechInput((text) => {
  const next = model.value + text.trim()
  model.value = props.maxlength ? next.slice(0, props.maxlength) : next
})

watch(
  () => props.disabled,
  (d) => d && stop(),
)

// 学习周报用：记录这次说了多久（不记录内容）
const { track } = useLearningEvents()
const recordVoice = () => seconds.value > 0 && track({ type: 'voice', value: Math.min(seconds.value, 1800) })
watch(listening, (on, wasOn) => wasOn && !on && recordVoice())
// 说着话直接提交时，组件会在停止前被卸载
onBeforeUnmount(() => listening.value && recordVoice())

const clock = computed(() => `${Math.floor(seconds.value / 60)}:${String(seconds.value % 60).padStart(2, '0')}`)
defineExpose({ stop })
</script>

<template>
  <div v-if="supported" class="voice">
    <button
      type="button"
      class="voice-btn"
      :class="{ on: listening }"
      :disabled="disabled"
      :aria-pressed="listening"
      :title="listening ? '停止语音输入' : '语音作答：口述回答，自动转成文字（识别由浏览器的在线服务完成）'"
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      <span>{{ listening ? `正在听 ${clock}` : '语音作答' }}</span>
    </button>
    <span v-if="listening && interim" class="interim" aria-live="polite">{{ interim }}</span>
    <span v-else-if="error" class="voice-error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.voice {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.voice-btn {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-full);
  background: var(--c-bg-elv);
  color: var(--c-text-2);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

.voice-btn:hover:not(:disabled) {
  border-color: var(--c-brand);
  color: var(--c-brand);
}

.voice-btn.on {
  border-color: var(--c-seal);
  background: color-mix(in srgb, var(--c-seal) 10%, var(--c-bg-elv));
  color: var(--c-seal);
  font-variant-numeric: tabular-nums;
}

.voice-btn.on svg {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

.voice-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.interim {
  overflow: hidden;
  font-size: 12.5px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-error {
  font-size: 12.5px;
  color: var(--st-weak-text);
}

@media (prefers-reduced-motion: reduce) {
  .voice-btn.on svg {
    animation: none;
  }
}
</style>
