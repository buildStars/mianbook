<script setup lang="ts">
const siteName = useRuntimeConfig().public.siteName
// 首页标题自己写全，不套"| 站名"
useHead({ title: `${siteName} · 把面试题讲成自己的话`, titleTemplate: null })

const { outline, all, firstPathOf } = useOutline()
const { records } = useStudy()
const { loggedIn } = useUserSession()
const { last } = useLastVisited()
const { summary } = useReview()

const firstPath = computed(() => all.value[0]?.path ?? '/')
const categoryCount = computed(() => outline.value.reduce((n, p) => n + p.categories.length, 0))
const isMastered = (id: number) => records.value[id]?.status === 'mastered'
const mastered = computed(() => all.value.filter((q) => isMastered(q.id)).length)

/** 推荐一道还没掌握的题去体验 AI 面试 */
const tryPath = computed(() => {
  const candidate = all.value.find((q) => !isMastered(q.id)) ?? all.value[0]
  return candidate ? `${candidate.path}#interview` : '/'
})

const partStats = (partId: number) => {
  const part = outline.value.find((p) => p.id === partId)
  const items = part?.categories.flatMap((c) => c.questions) ?? []
  return { total: items.length, done: items.filter((q) => isMastered(q.id)).length }
}

const catPct = (ids: number[]) => (ids.length ? (ids.filter(isMastered).length / ids.length) * 100 : 0)

/** 首页题卡插画背后两张卡片：取第二、三部分的第一道题，体现题库覆盖面 */
const backCards = computed(() =>
  outline.value
    .slice(1, 3)
    .map((p) => p.categories[0]?.questions[0])
    .filter((q) => !!q),
)

/** "不止刷题"：每个功能一句话说清楚，点进去就是入口。icon 是 24×24 线框图标的路径 */
const features = [
  {
    title: '问手册',
    ai: true,
    text: '用自己的话提问，AI 只依据手册内容回答，每句话标出处，点编号直达原题。',
    to: '/ask',
    icon: ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z', 'M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5', 'M12 16.5h.01'],
  },
  {
    title: '整场模拟面试',
    ai: true,
    text: '按方向和难度连续出题、追问，结束后给出各题得分、分类得分和复习建议。',
    to: '/mock',
    icon: ['M8 3.5h8v3H8z', 'M8 5H6.5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 17.5 5H16', 'M9 11h6M9 14.5h6M9 18h3'],
  },
  {
    title: '按简历出题',
    ai: true,
    text: '贴上项目经历，AI 针对你的项目深挖方案、难点和取舍，再补几道相关基础题。',
    to: '/mock?mode=resume',
    icon: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6M9 17h4'],
  },
  {
    title: 'Agent 面试官',
    ai: true,
    text: '会调用工具的面试官：先看你的薄弱点，再自己找题、打分，决定追问还是换题。',
    to: '/mock?mode=agent',
    icon: ['M8 8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z', 'M12 4v4', 'M9.5 13h.01M14.5 13h.01', 'M2 13v2M22 13v2'],
  },
  {
    title: '间隔复习与周报',
    ai: false,
    text: '按遗忘曲线安排复习，低分题自动进计划；每周一份学习报告，看清薄弱分类。',
    to: '/review',
    icon: ['M3 12a9 9 0 1 0 2.6-6.4L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  },
  {
    title: '接入 AI 工具',
    ai: false,
    text: '通过 MCP 在 Claude Code、Cursor 里检索手册，让 AI 按你的薄弱点出题考你。',
    to: '/connect',
    icon: ['M9 2v5M15 2v5', 'M6 7h12v4a6 6 0 0 1-12 0z', 'M12 17v5'],
  },
]

const steps = [
  { title: '先想再看', text: '打开自测模式，答案先藏起来，逼自己先回忆、先组织语言。' },
  { title: '让 AI 考你', text: '用自己的话作答，AI 对照参考答案打分，再顺着你的回答追问。' },
  { title: '标记掌握', text: '每道题标"不会 / 模糊 / 掌握"，可以收藏、写笔记。' },
  { title: '专攻薄弱', text: '在"我的进度"里集中复习没掌握的题，低分题会自动出现在这里。' },
]
</script>

<template>
  <div class="home">
    <!-- 封面 -->
    <section class="hero">
      <div class="container hero-grid">
        <div class="hero-copy">
          <p class="eyebrow">{{ siteName }} · 前端 / 后端 / AI 应用</p>
          <h1 class="serif">
            把面试题，<br>讲成<span class="underline">自己的话<svg viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true"><path d="M2 10 C 50 3, 120 3, 198 8" /></svg></span>
          </h1>
          <p class="lead">
            {{ all.length }} 道高频面试题，按目录系统整理。每道题都有一句话回答、详细解析、追问和易错点；读完再让 AI 面试官考你一遍。
          </p>
          <div class="cta">
            <NuxtLink :to="firstPath" class="btn btn-primary btn-lg">
              开始刷题
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </NuxtLink>
            <NuxtLink :to="tryPath" class="btn btn-lg ai-outline">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>
              <span class="ai-text">体验 AI 模拟面试</span>
            </NuxtLink>
          </div>
          <ClientOnly>
            <div class="resumes">
              <NuxtLink v-if="summary?.dueToday" to="/review" class="resume">
                <span class="resume-label due">今日复习</span>
                <span class="resume-title">{{ summary.dueToday }} 道题到期<template v-if="summary.streak">，已连续 {{ summary.streak }} 天</template></span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </NuxtLink>
              <NuxtLink v-if="last" :to="last.path" class="resume">
                <span class="resume-label">继续上次</span>
                <span class="resume-title">No.{{ last.num }} {{ plainTitle(last.title) }}</span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </NuxtLink>
            </div>
          </ClientOnly>
        </div>

        <div class="hero-visual" aria-hidden="true">
          <div v-for="(q, i) in backCards" :key="q.id" class="qcard back" :class="`back-${i + 1}`">
            <span class="qc-no serif">No.{{ String(q.num).padStart(2, '0') }}</span>
            <span class="skeleton" /><span class="skeleton short" />
          </div>
          <div class="qcard front">
            <div class="qc-top">
              <span class="qc-no serif">No.01</span>
              <span class="tag">JavaScript</span>
              <span class="tag">高频</span>
            </div>
            <p class="qc-title serif">说说浏览器的事件循环（Event Loop）</p>
            <div class="qc-answer">
              <span class="qc-label">一句话回答</span>
              <p>每轮先执行一个宏任务，再清空全部微任务，然后浏览器视情况渲染页面，如此循环。</p>
            </div>
            <div class="qc-foot">
              <span><i class="dot is-mastered" />已掌握</span>
              <span>Q1 · Q2 · Q3 追问</span>
            </div>
          </div>
          <div class="float score ai-border">
            <span class="float-label ai-text">AI 点评</span>
            <strong class="serif">7</strong><span class="of">/10</span>
          </div>
          <div class="float follow">
            <span class="float-label">追问</span>
            微任务里不断产生新的微任务会怎样？
          </div>
        </div>
      </div>
    </section>

    <!-- 数字 -->
    <section class="container">
      <dl class="stats">
        <div><dt>高频面试题</dt><dd class="serif">{{ all.length }}<small>道</small></dd></div>
        <div><dt>知识分类</dt><dd class="serif">{{ categoryCount }}<small>个</small></dd></div>
        <div><dt>AI 追问</dt><dd class="serif">3<small>轮</small></dd></div>
        <div>
          <dt>你已掌握</dt>
          <dd class="serif">
            {{ mastered }}<small>/ {{ all.length }}</small>
          </dd>
        </div>
      </dl>
    </section>

    <!-- 目录 -->
    <section class="container contents">
      <header class="section-head">
        <p class="eyebrow">CONTENTS · 目录</p>
        <h2 class="serif">题库目录</h2>
        <p class="muted">按"部分 → 分类 → 题目"组织，跟着目录一道道往下刷，也可以直接跳到薄弱的分类。</p>
      </header>

      <ol class="parts">
        <li v-for="(part, i) in outline" :key="part.id" class="part">
          <span class="part-no serif" aria-hidden="true">{{ String(i + 1).padStart(2, '0') }}</span>
          <div class="part-main">
            <div class="part-head">
              <h3 class="serif"><NuxtLink :to="firstPathOf(part)">{{ part.title }}</NuxtLink></h3>
              <span class="part-meta">
                {{ partStats(part.id).total }} 道题<template v-if="partStats(part.id).done"> · 已掌握 {{ partStats(part.id).done }}</template>
              </span>
            </div>
            <div class="cats">
              <NuxtLink v-for="cat in part.categories" :key="cat.id" :to="`/${part.slug}/${cat.slug}`" class="cat">
                <span class="cat-title">{{ cat.title }}</span>
                <span class="cat-count num">{{ cat.questions.length }}</span>
                <span class="cat-bar"><i :style="{ width: `${catPct(cat.questions.map((q) => q.id))}%` }" /></span>
              </NuxtLink>
            </div>
          </div>
          <NuxtLink :to="firstPathOf(part)" class="part-go" :aria-label="`从第一题开始学习${part.title}`">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </NuxtLink>
        </li>
      </ol>
    </section>

    <!-- AI 模拟面试官 -->
    <section class="ai-band">
      <div class="glow" aria-hidden="true" />
      <div class="container ai-grid">
        <div class="ai-copy">
          <p class="eyebrow">✦ 亮点功能</p>
          <h2 class="serif">AI 模拟面试官</h2>
          <p class="ai-lead">光看答案记不住，被追问才知道哪里没懂。用自己的话回答，AI 对照题库的参考答案打分、指出遗漏，再顺着你的回答追问下去。</p>
          <ol class="ai-steps">
            <li><b class="num">01</b><div><strong>作答</strong><span>像面试一样，用自己的话讲一遍</span></div></li>
            <li><b class="num">02</b><div><strong>点评</strong><span>0～10 分，答对的点、遗漏和错误逐条列出</span></div></li>
            <li><b class="num">03</b><div><strong>追问</strong><span>最多 3 轮；低分题自动加入复习计划</span></div></li>
          </ol>
          <div class="ai-actions">
            <NuxtLink to="/mock" class="btn btn-ai btn-lg">来一场整场模拟面试</NuxtLink>
            <NuxtLink :to="tryPath" class="ai-try">或者先试一道题 →</NuxtLink>
          </div>
        </div>

        <div class="chat" aria-hidden="true">
          <div class="chat-head">
            <span class="ai-avatar">✦</span>
            <div><strong>AI 面试官</strong><span>第 1 / 3 轮</span></div>
          </div>
          <div class="msg ai">说说浏览器的事件循环（Event Loop）</div>
          <div class="msg me">先执行同步代码，然后清空微任务队列，再取下一个宏任务执行……</div>
          <div class="review">
            <div class="review-head">
              <span>面试官点评</span>
              <span class="review-score"><b>7</b>/10</span>
            </div>
            <p><i class="mark ok">✓</i>说清了宏任务、微任务的执行顺序</p>
            <p><i class="mark miss">!</i>没提到每轮之后可能渲染，以及 requestAnimationFrame 的时机</p>
            <p class="next"><span class="next-label">追问</span><span>微任务里不断产生新的微任务会怎样？<span class="caret" /></span></p>
          </div>
        </div>
      </div>
    </section>

    <!-- 功能 -->
    <section class="container features">
      <header class="section-head">
        <p class="eyebrow">FEATURES · 功能</p>
        <h2 class="serif">不止刷题</h2>
        <p class="muted">从读懂一道题，到撑过一整场面试。</p>
      </header>
      <ul class="feature-grid">
        <li v-for="f in features" :key="f.title">
          <NuxtLink :to="f.to" class="feature">
            <span class="feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path v-for="d in f.icon" :key="d" :d="d" /></svg>
            </span>
            <h3>{{ f.title }}<span v-if="f.ai" class="feature-tag ai-text">AI</span></h3>
            <p>{{ f.text }}</p>
            <span class="feature-go">去看看 →</span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <!-- 方法 -->
    <section class="container method">
      <header class="section-head">
        <p class="eyebrow">METHOD · 用法</p>
        <h2 class="serif">四步刷一道题</h2>
      </header>
      <ol class="steps">
        <li v-for="(s, i) in steps" :key="s.title" class="step">
          <span class="step-no serif">{{ String(i + 1).padStart(2, '0') }}</span>
          <h3>{{ s.title }}</h3>
          <p>{{ s.text }}</p>
        </li>
      </ol>
    </section>

    <!-- 收尾 -->
    <section class="container">
      <div class="closing">
        <div>
          <h2 class="serif">从第 1 题开始，今天先刷 5 道。</h2>
          <p v-if="!loggedIn">注册后学习记录保存在服务器上，手机和电脑自动同步。</p>
          <p v-else>进度会自动保存，随时在"我的进度"里查看。</p>
        </div>
        <div class="closing-actions">
          <NuxtLink :to="firstPath" class="btn btn-primary btn-lg">开始刷题</NuxtLink>
          <NuxtLink v-if="!loggedIn" to="/register" class="btn btn-lg">免费注册</NuxtLink>
          <NuxtLink v-else to="/progress" class="btn btn-lg">我的进度</NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ---------- 封面 ---------- */
.hero {
  position: relative;
  overflow: hidden;
  padding: 72px 0 48px;
  background:
    radial-gradient(60% 60% at 85% 20%, color-mix(in srgb, var(--c-brand) 7%, transparent), transparent 70%),
    radial-gradient(40% 50% at 10% 0%, color-mix(in srgb, var(--ai-via) 5%, transparent), transparent 70%);
}

.hero::before {
  /* 纸张上的淡网格 */
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--c-divider) 1px, transparent 1px),
    linear-gradient(90deg, var(--c-divider) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 70% 60% at 70% 40%, #000 20%, transparent 75%);
  opacity: 0.55;
  pointer-events: none;
}

.hero-grid {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  align-items: center;
  gap: 48px;
}

.hero h1 {
  margin: 18px 0 0;
  font-size: clamp(40px, 5.4vw, 68px);
  font-weight: 900;
  line-height: 1.16;
  letter-spacing: -0.01em;
}

.underline {
  position: relative;
  display: inline-block;
  color: var(--c-brand);
}

.underline svg {
  position: absolute;
  right: 0;
  bottom: -6px;
  left: 0;
  width: 100%;
  height: 14px;
}

.underline path {
  fill: none;
  stroke: var(--c-brand);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-dasharray: 220;
  stroke-dashoffset: 220;
  animation: draw 0.9s 0.3s var(--ease) forwards;
}

@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}

.lead {
  max-width: 34em;
  margin: 26px 0 0;
  font-size: 18px;
  line-height: 1.85;
  color: var(--c-text-2);
}

.cta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 34px;
}

.ai-outline {
  border: 1px solid transparent;
  background:
    linear-gradient(var(--c-bg-elv), var(--c-bg-elv)) padding-box,
    var(--ai-grad) border-box;
  color: var(--ai-text);
}

.ai-outline:hover:not(:disabled) {
  border-color: transparent;
  box-shadow: 0 8px 24px -10px rgba(110, 80, 240, 0.55);
}

.resume {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  margin-top: 22px;
  padding: 8px 12px 8px 8px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-full);
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  font-size: 14px;
  box-shadow: var(--shadow-xs);
  transition: border-color var(--dur);
}

.resume:hover {
  border-color: var(--c-border);
}

.resume-label {
  flex: none;
  padding: 2px 10px;
  border-radius: var(--r-full);
  background: var(--c-brand-soft);
  color: var(--c-brand);
  font-size: 12px;
  font-weight: 600;
}

.resume-label.due {
  background: color-mix(in srgb, var(--c-seal) 14%, transparent);
  color: var(--c-seal);
}

.resumes {
  display: flex;
  flex-wrap: wrap;
  gap: 0 12px;
}

.resume-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 题卡插画 */
.hero-visual {
  position: relative;
  height: 460px;
}

.qcard {
  position: absolute;
  top: 60px;
  left: 50%;
  width: min(420px, 100%);
  padding: 24px 26px;
  border: 1px solid var(--c-divider);
  border-radius: 18px;
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-lg);
}

.qcard.back {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 150px;
  box-shadow: var(--shadow-md);
}

.skeleton {
  display: block;
  width: 86%;
  height: 12px;
  border-radius: var(--r-full);
  background: var(--c-bg-mute);
}

.skeleton.short {
  width: 52%;
}

.back-1 {
  transform: translate(-46%, -28px) rotate(5deg);
  opacity: 0.75;
}

.back-2 {
  transform: translate(-58%, 8px) rotate(-6deg);
  opacity: 0.5;
}

.front {
  transform: translate(-50%, 34px) rotate(-1deg);
}

.qc-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qc-no {
  margin-right: 4px;
  font-size: 15px;
  font-weight: 700;
  color: var(--c-brand);
}

.qc-title {
  margin: 10px 0 0;
  font-size: 21px;
  font-weight: 700;
  line-height: 1.45;
}

.qc-answer {
  position: relative;
  margin-top: 16px;
  padding: 12px 14px 12px 16px;
  border-radius: var(--r-md);
  background: var(--c-brand-softer);
  font-size: 14px;
  line-height: 1.75;
  color: var(--c-text-2);
}

.qc-answer::before {
  content: '';
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 0;
  width: 3px;
  border-radius: 3px;
  background: var(--c-brand);
}

.qc-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--c-brand);
}

.qc-answer p {
  margin: 4px 0 0;
}

.qc-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
  font-size: 12px;
  color: var(--c-text-3);
}

.qc-foot span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.float {
  position: absolute;
  z-index: 2;
  border-radius: 14px;
  box-shadow: var(--shadow-md);
  font-size: 13px;
}

.score {
  top: 36px;
  right: 2%;
  display: flex;
  align-items: baseline;
  gap: 2px;
  padding: 10px 16px;
  animation: float 6s ease-in-out infinite;
}

.score strong {
  margin-left: 8px;
  font-size: 30px;
  line-height: 1;
}

.of {
  color: var(--c-text-3);
}

.float-label {
  font-size: 12px;
  font-weight: 700;
}

.follow {
  bottom: 22px;
  left: 0;
  max-width: 280px;
  padding: 12px 16px;
  border: 1px solid var(--c-divider);
  background: var(--c-bg-elv);
  line-height: 1.6;
  animation: float 6s 1.5s ease-in-out infinite;
}

.follow .float-label {
  display: block;
  margin-bottom: 2px;
  color: var(--c-brand);
}

@keyframes float {
  50% {
    transform: translateY(-8px);
  }
}

/* ---------- 数字 ---------- */
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin: 24px 0 0;
  border-top: 1px solid var(--c-text-1);
  border-bottom: 1px solid var(--c-divider);
}

.stats div {
  padding: 22px 24px;
}

.stats div + div {
  border-left: 1px solid var(--c-divider);
}

.stats dt {
  font-size: 13px;
  color: var(--c-text-3);
}

.stats dd {
  margin: 6px 0 0;
  font-size: 40px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.stats small {
  margin-left: 6px;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text-3);
}

/* ---------- 区块标题 ---------- */
.section-head {
  max-width: 640px;
}

.section-head h2 {
  margin: 10px 0 0;
  font-size: clamp(30px, 3.4vw, 40px);
  font-weight: 800;
  line-height: 1.25;
}

.section-head p:not(.eyebrow) {
  margin: 12px 0 0;
  font-size: 16px;
  line-height: 1.8;
}

/* ---------- 目录 ---------- */
.contents {
  margin-top: 96px;
}

.parts {
  margin: 36px 0 0;
  padding: 0;
  list-style: none;
}

.part {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) 48px;
  gap: 24px;
  padding: 32px 0;
  border-top: 1px solid var(--c-divider);
}

.part:last-child {
  border-bottom: 1px solid var(--c-divider);
}

.part-no {
  font-size: 56px;
  font-weight: 800;
  line-height: 1;
  color: transparent;
  -webkit-text-stroke: 1.5px var(--c-text-3);
}

.part:hover .part-no {
  color: var(--c-brand);
  -webkit-text-stroke-color: var(--c-brand);
  transition: color var(--dur);
}

.part-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 16px;
}

.part-head h3 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
}

.part-head h3 a {
  color: var(--c-text-1);
}

.part-meta {
  font-size: 14px;
  color: var(--c-text-3);
}

.cats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.cat {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px 14px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-md);
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  overflow: hidden;
  transition:
    border-color var(--dur),
    transform var(--dur) var(--ease),
    box-shadow var(--dur);
}

.cat:hover {
  border-color: var(--c-border);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.cat-title {
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-count {
  flex: none;
  font-size: 13px;
  color: var(--c-text-3);
}

.cat-bar {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  background: var(--c-bg-soft);
}

.cat-bar i {
  display: block;
  height: 100%;
  background: var(--st-mastered);
  transition: width var(--dur-slow) var(--ease);
}

.part-go {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: start;
  width: 48px;
  height: 48px;
  border: 1px solid var(--c-divider);
  border-radius: 50%;
  color: var(--c-text-1);
  transition:
    background-color var(--dur),
    color var(--dur),
    border-color var(--dur);
}

.part-go:hover {
  border-color: var(--c-ink);
  background: var(--c-ink);
  color: var(--c-on-ink);
}

/* ---------- AI 区块：深色 ---------- */
.ai-band {
  position: relative;
  margin-top: 112px;
  padding: 96px 0;
  overflow: hidden;
  background: #121318;
  color: #ecebe7;
  isolation: isolate;
}

html.dark .ai-band {
  border-top: 1px solid var(--c-divider);
  border-bottom: 1px solid var(--c-divider);
  background: #0d0e12;
}

.glow {
  position: absolute;
  inset: -40% -10% auto auto;
  z-index: -1;
  width: 70%;
  height: 160%;
  background:
    radial-gradient(closest-side, rgba(59, 91, 255, 0.35), transparent 70%),
    radial-gradient(closest-side at 70% 60%, rgba(139, 92, 246, 0.3), transparent 70%),
    radial-gradient(closest-side at 40% 80%, rgba(232, 85, 155, 0.22), transparent 70%);
  filter: blur(20px);
}

.ai-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: 64px;
}

.ai-band .eyebrow {
  color: #b6a9ff;
}

.ai-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}

.ai-try {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.72);
}

.ai-try:hover {
  color: #fff;
}

@media (pointer: coarse) {
  .ai-try {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
}

.ai-band h2 {
  margin: 12px 0 0;
  font-size: clamp(32px, 4vw, 48px);
  font-weight: 800;
  line-height: 1.2;
}

.ai-lead {
  margin: 18px 0 0;
  font-size: 17px;
  line-height: 1.85;
  color: rgba(236, 235, 231, 0.72);
}

.ai-steps {
  display: grid;
  gap: 14px;
  margin: 30px 0 34px;
  padding: 0;
  list-style: none;
}

.ai-steps li {
  display: flex;
  gap: 16px;
  align-items: baseline;
}

.ai-steps b {
  flex: none;
  font-family: var(--font-mono);
  font-size: 13px;
  color: #8f9bff;
}

.ai-steps strong {
  margin-right: 10px;
  font-size: 16px;
}

.ai-steps span {
  color: rgba(236, 235, 231, 0.62);
  font-size: 15px;
}

.chat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 40px 80px -30px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  font-size: 14px;
  line-height: 1.7;
}

.chat-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.chat-head div {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}

.chat-head span {
  font-size: 12px;
  color: rgba(236, 235, 231, 0.5);
}

.ai-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--ai-grad);
  color: #fff;
  font-size: 16px;
}

.msg {
  max-width: 86%;
  padding: 10px 14px;
  border-radius: 14px;
}

.msg.ai {
  border-top-left-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  font-weight: 500;
}

.msg.me {
  align-self: flex-end;
  border-top-right-radius: 4px;
  background: #3b5bff;
  color: #fff;
}

.review {
  padding: 14px 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.25);
}

.review-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 12px;
  color: rgba(236, 235, 231, 0.55);
}

.review-score {
  padding: 0 10px;
  border-radius: var(--r-full);
  background: rgba(242, 193, 78, 0.16);
  color: #f2c14e;
}

.review-score b {
  font-size: 15px;
}

.review p {
  display: flex;
  gap: 10px;
  margin: 6px 0 0;
  color: rgba(236, 235, 231, 0.8);
}

.review .mark {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 3px;
  border-radius: 50%;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 18px;
  text-align: center;
}

.review .ok {
  background: rgba(61, 207, 142, 0.18);
  color: #3dcf8e;
}

.review .miss {
  background: rgba(242, 193, 78, 0.18);
  color: #f2c14e;
}

.review .next {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.12);
  color: #fff;
}

.review .next-label {
  flex: none;
  font-size: 12px;
  font-weight: 700;
  color: #b6a9ff;
  line-height: 24px;
}

.caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 3px;
  vertical-align: -2px;
  background: #b6a9ff;
  animation: blink 1s steps(1) infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

/* ---------- 功能 ---------- */
.features {
  margin-top: 112px;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin: 36px 0 0;
  padding: 0;
  list-style: none;
}

.feature {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}

.feature:hover {
  border-color: var(--c-border);
  box-shadow: var(--shadow-sm);
  transform: translateY(-2px);
}

.feature-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  background: var(--c-brand-soft);
  color: var(--c-brand);
}

.feature h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 0;
  font-size: 18px;
}

.feature-tag {
  padding: 0 6px;
  border: 1px solid color-mix(in srgb, var(--ai-via) 30%, transparent);
  border-radius: var(--r-full);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 18px;
}

.feature p {
  flex: 1;
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--c-text-2);
}

.feature-go {
  margin-top: 14px;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-brand);
}

/* ---------- 用法 ---------- */
.method {
  margin-top: 112px;
}

.steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin: 36px 0 0;
  padding: 0;
  list-style: none;
}

.step {
  padding: 26px 24px 28px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
}

.step-no {
  display: block;
  font-size: 32px;
  font-weight: 800;
  line-height: 1;
  color: var(--c-brand);
}

.step h3 {
  margin: 18px 0 0;
  font-size: 18px;
}

.step p {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--c-text-2);
}

/* ---------- 收尾 ---------- */
.closing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: 96px;
  padding: 40px 44px;
  border-radius: var(--r-xl);
  background: var(--c-bg-soft);
  border: 1px solid var(--c-divider);
}

.closing h2 {
  margin: 0;
  font-size: clamp(24px, 2.8vw, 32px);
  font-weight: 800;
}

.closing p {
  margin: 8px 0 0;
  color: var(--c-text-2);
}

.closing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

/* ---------- 响应式 ---------- */
@media (max-width: 1023px) {
  .hero-grid,
  .ai-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .hero-visual {
    max-width: 520px;
    height: 420px;
    margin: 0 auto;
    width: 100%;
  }

  .steps,
  .feature-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .hero {
    padding: 40px 0 24px;
  }

  .lead {
    font-size: 16px;
  }

  .cta .btn {
    flex: 1;
  }

  .hero-visual {
    height: 340px;
  }

  .qcard {
    padding: 18px 20px;
  }

  .qc-title {
    font-size: 18px;
  }

  .qcard.back {
    display: none;
  }

  .front {
    top: 34px;
    transform: translate(-50%, 0) rotate(-1deg);
  }

  .score {
    top: 0;
  }

  .follow {
    bottom: 0;
    max-width: 230px;
  }

  .stats {
    grid-template-columns: repeat(2, 1fr);
  }

  .stats div:nth-child(3) {
    border-left: none;
  }

  .stats div:nth-child(n + 3) {
    border-top: 1px solid var(--c-divider);
  }

  .stats div {
    padding: 16px;
  }

  .stats dd {
    font-size: 32px;
  }

  .contents,
  .method {
    margin-top: 72px;
  }

  .part {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 24px 0;
  }

  .part-no {
    font-size: 36px;
  }

  .part-go {
    display: none;
  }

  .cats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ai-band {
    margin-top: 80px;
    padding: 64px 0;
  }

  .steps,
  .feature-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .features {
    margin-top: 80px;
  }

  .closing {
    padding: 28px 22px;
  }

  .closing-actions .btn {
    flex: 1;
  }
}
</style>
