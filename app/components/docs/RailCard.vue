<script setup lang="ts">
import type { StudyStatus } from '#shared/types/handbook'

/** 右侧栏：随时标记掌握程度、开始 AI 面试，不用滚到页面底部 */
const props = defineProps<{ questionId: number }>()
const emit = defineEmits<{ interview: [] }>()

const { records, setStatus } = useStudy()
const status = computed(() => records.value[props.questionId]?.status ?? null)
const options: StudyStatus[] = ['weak', 'fuzzy', 'mastered']
const choose = (s: StudyStatus) => setStatus(props.questionId, status.value === s ? null : s)
</script>

<template>
  <div class="rail-card">
    <p class="label">这道题你</p>
    <div class="seg" role="group" aria-label="掌握程度">
      <button
        v-for="s in options"
        :key="s"
        type="button"
        :class="[`is-${s}`, { active: status === s }]"
        :aria-pressed="status === s"
        @click="choose(s)"
      >
        <span class="dot" :class="`is-${s}`" />{{ STATUS_LABELS[s] }}
      </button>
    </div>
    <button type="button" class="ai-cta" @click="emit('interview')">
      <span class="spark" aria-hidden="true">✦</span>
      <span class="ai-copy">
        <strong>让 AI 考考你</strong>
        <small>打分 · 挑漏洞 · 追问</small>
      </span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </button>
  </div>
</template>

<style scoped>
.rail-card {
  margin-top: 28px;
  padding: 16px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
}

.label {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--c-text-3);
}

.seg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 3px;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
}

.seg button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--c-text-2);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--dur-fast),
    color var(--dur-fast);
}

.seg .dot {
  width: 6px;
  height: 6px;
}

.seg button:hover {
  color: var(--c-text-1);
}

.seg button.active {
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-xs);
  font-weight: 600;
}

.seg .active.is-weak { color: var(--st-weak-text); }
.seg .active.is-fuzzy { color: var(--st-fuzzy-text); }
.seg .active.is-mastered { color: var(--st-mastered-text); }

.ai-cta {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  background:
    linear-gradient(var(--c-bg-elv), var(--c-bg-elv)) padding-box,
    var(--ai-grad) border-box;
  text-align: left;
  cursor: pointer;
  transition: box-shadow var(--dur);
}

.ai-cta:hover {
  box-shadow: 0 8px 20px -10px rgba(110, 80, 240, 0.55);
}

.spark {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--ai-grad);
  color: #fff;
  font-size: 14px;
}

.ai-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  line-height: 1.4;
}

.ai-copy strong {
  font-size: 13px;
}

.ai-copy small {
  font-size: 12px;
  color: var(--c-text-3);
}

.ai-cta svg {
  color: var(--c-text-3);
}
</style>
