<script setup lang="ts">
import type { StudyStatus } from '#shared/types/handbook'

const props = defineProps<{ questionId: number }>()
const { records, error, setStatus, setNote } = useStudy()
const { loggedIn } = useUserSession()
const route = useRoute()

const rec = computed(() => records.value[props.questionId])

const options: { value: StudyStatus; hint: string }[] = [
  { value: 'weak', hint: '想不起来，需要重新学' },
  { value: 'fuzzy', hint: '大概知道，但讲不完整' },
  { value: 'mastered', hint: '能完整讲给面试官听' },
]

const choose = (s: StudyStatus) => setStatus(props.questionId, rec.value?.status === s ? null : s)

const noteOpen = ref(false)
watch(
  () => props.questionId,
  () => (noteOpen.value = false),
)
const showNote = computed(() => noteOpen.value || !!rec.value?.note)
const note = computed({
  get: () => rec.value?.note ?? '',
  set: (v: string) => {
    noteOpen.value = true // 删光内容时输入框不要消失
    setNote(props.questionId, v)
  },
})
</script>

<template>
  <section class="study">
    <div class="study-head">
      <h2 class="serif">这道题你掌握了吗？</h2>
      <p>选一个最接近的状态，没掌握的题会出现在"我的进度 · 待复习"里。</p>
    </div>

    <div class="options" role="group" aria-label="掌握程度">
      <button
        v-for="o in options"
        :key="o.value"
        type="button"
        class="opt"
        :class="[`is-${o.value}`, { active: rec?.status === o.value }]"
        :aria-pressed="rec?.status === o.value"
        @click="choose(o.value)"
      >
        <span class="opt-top"><span class="dot" :class="`is-${o.value}`" />{{ STATUS_LABELS[o.value] }}</span>
        <small>{{ o.hint }}</small>
      </button>
    </div>

    <div v-if="showNote" class="note">
      <label class="note-label" :for="`note-${questionId}`">我的笔记 <span>自动保存</span></label>
      <textarea
        :id="`note-${questionId}`"
        v-model="note"
        rows="4"
        placeholder="用自己的话复述一遍，或者记下面试里被追问的细节……"
      />
    </div>
    <button v-else type="button" class="add-note" @click="noteOpen = true">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
      写笔记
    </button>

    <p v-if="!loggedIn" class="hint">
      学习记录暂存在本机浏览器。<NuxtLink :to="`/login?redirect=${encodeURIComponent(route.fullPath)}`">登录</NuxtLink>后自动同步到账号，换设备也能看到。
    </p>
    <p v-if="error" class="hint error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.study {
  margin-top: 56px;
  padding-top: 32px;
  border-top: 1px solid var(--c-divider);
}

.study-head h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.study-head p {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--c-text-2);
}

.options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 18px;
}

.opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg-elv);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--dur),
    background-color var(--dur),
    box-shadow var(--dur);
}

.opt:hover {
  border-color: var(--c-border);
  box-shadow: var(--shadow-xs);
}

.opt-top {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text-1);
}

.opt small {
  font-size: 12px;
  color: var(--c-text-3);
}

.opt.active.is-weak {
  border-color: var(--st-weak);
  background: color-mix(in srgb, var(--st-weak) 7%, var(--c-bg-elv));
}

.opt.active.is-fuzzy {
  border-color: var(--st-fuzzy);
  background: color-mix(in srgb, var(--st-fuzzy) 9%, var(--c-bg-elv));
}

.opt.active.is-mastered {
  border-color: var(--st-mastered);
  background: color-mix(in srgb, var(--st-mastered) 8%, var(--c-bg-elv));
}

.opt.active.is-weak .opt-top { color: var(--st-weak-text); }
.opt.active.is-fuzzy .opt-top { color: var(--st-fuzzy-text); }
.opt.active.is-mastered .opt-top { color: var(--st-mastered-text); }

.note {
  margin-top: 18px;
}

.note-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}

.note-label span {
  font-size: 12px;
  font-weight: 400;
  color: var(--c-text-3);
}

textarea {
  display: block;
  width: 100%;
  min-height: 110px;
  padding: 12px 14px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  font: inherit;
  font-size: 14px;
  line-height: 1.75;
  resize: vertical;
  transition:
    border-color var(--dur),
    box-shadow var(--dur);
}

textarea:focus {
  border-color: var(--c-brand);
  outline: none;
  box-shadow: 0 0 0 3px var(--c-brand-soft);
}

.add-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  padding: 0;
  border: none;
  background: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--c-brand);
  cursor: pointer;
}

@media (pointer: coarse) {
  .add-note {
    min-height: 44px;
    margin-top: 6px;
  }
}

.hint {
  margin: 14px 0 0;
  font-size: 13px;
  color: var(--c-text-3);
}

.hint.error {
  color: var(--c-danger);
}

@media (max-width: 640px) {
  .options {
    grid-template-columns: minmax(0, 1fr);
  }

  .opt {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
