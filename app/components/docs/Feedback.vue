<script setup lang="ts">
/** 题目页底部的纠错入口：没登录也能提交，后台在"反馈"里处理 */
const props = defineProps<{ questionId: number }>()

const open = ref(false)
const kind = ref<FeedbackKind>('error')
const content = ref('')
/** 给机器人填的隐藏字段 */
const website = ref('')
const sending = ref(false)
const sent = ref(false)
const errorMsg = ref('')
const textarea = ref<HTMLTextAreaElement>()

const PLACEHOLDERS: Record<FeedbackKind, string> = {
  error: '哪里写错了？比如："详细解析第 2 段说 xxx，实际上是 yyy"，能附上文档链接更好',
  unclear: '哪一段没看懂，或者希望补充什么？',
  outdated: '哪部分过时了？新版本里是怎样的？',
  other: '想说的都可以写在这里',
}

watch(
  () => props.questionId,
  () => {
    open.value = false
    sent.value = false
    content.value = ''
    errorMsg.value = ''
  },
)

function show() {
  open.value = true
  sent.value = false
  nextTick(() => textarea.value?.focus())
}

async function submit() {
  if (sending.value) return
  errorMsg.value = ''
  if (content.value.trim().length < FEEDBACK_MIN_LENGTH) {
    errorMsg.value = `至少写 ${FEEDBACK_MIN_LENGTH} 个字，说说哪里有问题`
    return
  }
  sending.value = true
  try {
    await $fetch('/api/feedback', {
      method: 'POST',
      body: { questionId: props.questionId, kind: kind.value, content: content.value, website: website.value },
    })
    sent.value = true
    open.value = false
    content.value = ''
  } catch (error) {
    errorMsg.value = errorMessage(error)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section class="feedback" aria-label="纠错和反馈">
    <div v-if="!open" class="bar">
      <p v-if="sent" class="thanks" role="status">收到了，谢谢！核对后会直接改在这道题里。</p>
      <p v-else>发现错误、讲得不清楚或者已经过时？</p>
      <button type="button" class="btn btn-sm btn-ghost" @click="show">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V4h11l-1 4h6v9h-9l1-4H4" /></svg>
        {{ sent ? '再反馈一条' : '纠错 / 反馈' }}
      </button>
    </div>

    <form v-else class="form card" @submit.prevent="submit">
      <div class="kinds" role="radiogroup" aria-label="问题类型">
        <button
          v-for="k in FEEDBACK_KINDS"
          :key="k"
          type="button"
          role="radio"
          class="kind"
          :aria-checked="kind === k"
          @click="kind = k"
        >
          {{ FEEDBACK_KIND_LABELS[k] }}
        </button>
      </div>
      <textarea
        ref="textarea"
        v-model="content"
        rows="4"
        :maxlength="FEEDBACK_MAX_LENGTH"
        :placeholder="PLACEHOLDERS[kind]"
        aria-label="反馈内容"
      />
      <label class="visually-hidden" aria-hidden="true">
        网站
        <input v-model="website" type="text" name="website" tabindex="-1" autocomplete="off">
      </label>
      <div class="form-foot">
        <span class="hint">{{ content.length }}/{{ FEEDBACK_MAX_LENGTH }} · 不用登录也能提交</span>
        <span class="actions">
          <button type="button" class="btn btn-sm btn-ghost" @click="open = false">取消</button>
          <button type="submit" class="btn btn-sm btn-primary" :disabled="sending">{{ sending ? '提交中…' : '提交' }}</button>
        </span>
      </div>
      <p v-if="errorMsg" class="error" role="alert">{{ errorMsg }}</p>
    </form>
  </section>
</template>

<style scoped>
.feedback {
  margin-top: 32px;
}

.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 12px 16px;
  border: 1px dashed var(--c-border);
  border-radius: var(--r-md);
  font-size: 14px;
  color: var(--c-text-2);
}

.bar p {
  margin: 0;
}

.thanks {
  color: var(--st-mastered-text);
}

.form {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.kind {
  padding: 4px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-full);
  background: var(--c-bg-elv);
  font-size: 13px;
  color: var(--c-text-2);
  cursor: pointer;
}

.kind[aria-checked='true'] {
  border-color: var(--c-ink);
  background: var(--c-ink);
  color: var(--c-on-ink);
}

textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg);
  font: inherit;
  font-size: 14px;
  line-height: 1.7;
  color: var(--c-text-1);
  resize: vertical;
}

textarea:focus-visible {
  outline: 2px solid var(--c-brand);
  outline-offset: 1px;
}

.form-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hint {
  font-size: 12px;
  color: var(--c-text-3);
}

.actions {
  display: flex;
  gap: 8px;
}

.error {
  margin: 0;
  font-size: 13px;
  color: var(--st-weak-text);
}
</style>
