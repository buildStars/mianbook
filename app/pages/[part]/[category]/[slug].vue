<script setup lang="ts">
import type { QuestionDetail } from '#shared/types/handbook'

definePageMeta({ layout: 'docs' })

const route = useRoute()
const path = computed(() => `/${route.params.part}/${route.params.category}/${route.params.slug}`)

const { data: question, error } = await useFetch<QuestionDetail>(() => `/api/questions${path.value}`, {
  key: computed(() => `question:${path.value}`),
})

if (error.value || !question.value) {
  throw createError({ statusCode: 404, statusMessage: '这道题不存在或还没有发布', fatal: true })
}

useHead(() => ({
  title: question.value ? `${plainTitle(question.value.title)} | 全栈面试手册` : '全栈面试手册',
}))

const quiz = useQuizMode()
const revealed = ref(false)
watch(path, () => (revealed.value = false))
const hidden = computed(() => quiz.value && !revealed.value)

const interview = ref<{ open: () => void }>()

// 学习周报用：记录有效阅读时长，以及自测模式里查看答案
useReadingTime(() => question.value?.id)
const { track } = useLearningEvents()
function reveal() {
  revealed.value = true
  if (question.value) track({ type: 'reveal', questionId: question.value.id })
}

// 记住看到哪道题，首页提供"继续上次"
const { save: saveLastVisited } = useLastVisited()
const remember = () => {
  if (question.value) saveLastVisited({ path: question.value.path, title: question.value.title, num: question.value.num })
}
onMounted(remember)
watch(() => question.value?.id, remember)
</script>

<template>
  <div v-if="question" class="doc-page">
    <article class="doc">
      <DocsQuestionHead :question="question" @interview="interview?.open()" />

      <div class="body-wrap" :class="{ veiled: hidden }">
        <DocsQuestionBody :html="question.html" :inert="hidden" :aria-hidden="hidden" />
        <div v-if="hidden" class="veil">
          <p class="veil-kicker">自测模式</p>
          <p class="veil-title serif">先自己答一遍，再看答案</p>
          <p class="veil-text">在心里把答案完整讲一遍，或者让 AI 面试官考考你。想好了再展开参考答案。</p>
          <div class="veil-actions">
            <button type="button" class="btn btn-ai" @click="interview?.open()">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>
              让 AI 考我
            </button>
            <button type="button" class="btn btn-primary" @click="reveal">查看答案</button>
          </div>
        </div>
      </div>

      <InterviewPanel ref="interview" :question="question" />
      <DocsStudyPanel :question-id="question.id" />
      <DocsPrevNext :prev="question.prev" :next="question.next" />
    </article>

    <aside class="rail">
      <div class="rail-inner">
        <DocsOutline v-if="!hidden" :toc="question.toc" />
        <DocsRailCard :question-id="question.id" @interview="interview?.open()" />
      </div>
    </aside>

    <DocsMobileBar :prev="question.prev" :next="question.next" @interview="interview?.open()" />
  </div>
</template>

<style scoped>
.doc-page {
  display: flex;
  justify-content: center;
  gap: 56px;
  padding: 40px 32px 120px;
}

.doc {
  flex: 1;
  min-width: 0;
  max-width: 760px;
}

/* 自测模式：正文模糊、只露出一截，上面盖一张提示卡 */
.body-wrap {
  position: relative;
}

.body-wrap.veiled {
  max-height: 420px;
  overflow: hidden;
}

.body-wrap.veiled :deep(.doc-content) {
  filter: blur(7px);
  opacity: 0.6;
  user-select: none;
  pointer-events: none;
  mask-image: linear-gradient(to bottom, #000 40%, transparent 95%);
}

.veil {
  position: absolute;
  top: 48px;
  left: 50%;
  width: min(460px, calc(100% - 32px));
  padding: 28px 28px 24px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-xl);
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-lg);
  text-align: center;
  transform: translateX(-50%);
}

.veil-kicker {
  display: inline-block;
  margin: 0;
  padding: 2px 10px;
  border-radius: var(--r-full);
  background: var(--c-brand-soft);
  color: var(--c-brand);
  font-size: 12px;
  font-weight: 600;
}

.veil-title {
  margin: 12px 0 0;
  font-size: 22px;
  font-weight: 800;
}

.veil-text {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--c-text-2);
}

.veil-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 20px;
}

.rail {
  display: none;
  flex: none;
  width: 248px;
}

.rail-inner {
  position: sticky;
  top: calc(var(--header-h) + 40px);
  max-height: calc(100vh - var(--header-h) - 64px);
  overflow-y: auto;
  scrollbar-width: none;
}

@media (min-width: 1280px) {
  .rail {
    display: block;
  }
}

@media (max-width: 959px) {
  .doc-page {
    padding-bottom: calc(120px + env(safe-area-inset-bottom));
  }
}

@media (max-width: 640px) {
  .doc-page {
    padding: 24px 16px calc(110px + env(safe-area-inset-bottom));
  }

  .veil {
    top: 24px;
    padding: 22px 18px 18px;
  }

  .veil-actions .btn {
    flex: 1;
  }
}
</style>
