<script setup lang="ts">
import type { AppIconName } from '~/components/AppIcon.vue'

useHead({ title: '个人中心' })

/**
 * 个人中心：手机底部的"我的"、宽屏"我的"面板里的"个人中心"都到这里。
 * 上面是几个数字，下面按"学习 / AI 功能 / 设置"列出全部个人入口。
 * 未登录也能看：学习记录先存在本机，需要登录的入口标出来
 */
const { loggedIn, user, clear } = useUserSession()
const { ready } = useStudy()
const { starred, noted, mastered, total } = useCollection()
const { summary } = useReview()
const colorMode = useColorMode()

const due = computed(() => summary.value?.dueToday ?? 0)
const pct = computed(() => (total.value ? Math.round((mastered.value / total.value) * 100) : 0))
const ring = computed(() => {
  const c = 2 * Math.PI * 30
  return { c, offset: c * (1 - pct.value / 100) }
})
/** 学习记录在浏览器端加载，加载完之前数字先显示占位 */
const show = (n: number) => (ready.value ? n : '–')

interface Row {
  to: string
  icon: AppIconName
  title: string
  desc: string
  extra?: string | number
  /** 要登录才能用，未登录时标出来 */
  login?: boolean
  ai?: boolean
}

const groups = computed<{ title: string; rows: Row[] }[]>(() => [
  {
    title: '学习',
    rows: [
      { to: '/progress', icon: 'progress', title: '学习进度', desc: '题目地图、薄弱点分析和复习清单', extra: ready.value ? `${pct.value}%` : '' },
      { to: '/favorites', icon: 'star', title: '我的收藏', desc: '收藏过的题，按分类放好', extra: starred.value.length || '' },
      { to: '/favorites?tab=notes', icon: 'note', title: '我的笔记', desc: '在题目页写下的笔记，最近改的在前', extra: noted.value.length || '' },
      { to: '/review', icon: 'review', title: '今日复习', desc: '按遗忘规律安排今天该复习的题', extra: due.value ? `${due.value} 道` : '', login: true },
      { to: '/report', icon: 'report', title: '学习周报', desc: '这周学了多少、哪些题最卡', login: true },
    ],
  },
  {
    title: 'AI 功能',
    rows: [
      { to: '/mock', icon: 'sparkle', title: '模拟面试', desc: 'AI 面试官按题库出题、追问、打分', ai: true },
      { to: '/ask', icon: 'ask', title: '问手册', desc: '有问题直接问，用题库里的内容回答你' },
      { to: '/connect', icon: 'connect', title: '接入 AI 工具', desc: '在 Claude、Cursor 等工具里查题、记进度', login: true },
    ],
  },
])

const themes = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

async function logout() {
  await clear()
  await navigateTo('/')
}
</script>

<template>
  <div class="page container">
    <header class="me-head">
      <span class="me-avatar">
        <svg viewBox="0 0 68 68" width="68" height="68" aria-hidden="true">
          <circle cx="34" cy="34" r="30" fill="none" stroke="var(--c-divider)" stroke-width="4" />
          <circle
            cx="34"
            cy="34"
            r="30"
            fill="none"
            stroke="var(--st-mastered)"
            stroke-width="4"
            stroke-linecap="round"
            :stroke-dasharray="ring.c"
            :stroke-dashoffset="ring.offset"
            transform="rotate(-90 34 34)"
          />
        </svg>
        <span v-if="loggedIn" class="avatar">{{ user?.name?.slice(0, 1) }}</span>
        <span v-else class="avatar guest"><AppIcon name="user" :size="24" /></span>
      </span>
      <div class="who">
        <p class="eyebrow">个人中心</p>
        <h1 class="serif">{{ loggedIn ? user?.name : '还没有登录' }}</h1>
        <p class="sub">
          <template v-if="loggedIn">
            {{ user?.email }}<span v-if="user?.role === 'admin'" class="tag">管理员</span>
          </template>
          <template v-else>学习记录先存在这台设备上。登录后多设备同步，还能用学习周报、复习提醒和 AI 工具接入。</template>
        </p>
      </div>
      <div v-if="!loggedIn" class="auth">
        <NuxtLink to="/register?redirect=/me" class="btn">注册</NuxtLink>
        <NuxtLink to="/login?redirect=/me" class="btn btn-primary">登录</NuxtLink>
      </div>
    </header>

    <div class="stats" :class="{ three: !loggedIn }">
      <NuxtLink to="/progress" class="stat">
        <span class="stat-num serif">{{ show(mastered) }}<small v-if="ready">/{{ total }}</small></span>
        <span class="stat-label">已掌握</span>
      </NuxtLink>
      <NuxtLink to="/favorites" class="stat">
        <span class="stat-num serif">{{ show(starred.length) }}</span>
        <span class="stat-label">收藏</span>
      </NuxtLink>
      <NuxtLink to="/favorites?tab=notes" class="stat">
        <span class="stat-num serif">{{ show(noted.length) }}</span>
        <span class="stat-label">笔记</span>
      </NuxtLink>
      <NuxtLink v-if="loggedIn" to="/review" class="stat" :class="{ hot: due }">
        <span class="stat-num serif">{{ summary ? due : '–' }}</span>
        <span class="stat-label">今日待复习</span>
      </NuxtLink>
    </div>

    <section v-for="g in groups" :key="g.title" class="group">
      <h2 class="group-title">{{ g.title }}</h2>
      <ul class="rows">
        <li v-for="r in g.rows" :key="r.to">
          <NuxtLink :to="r.to" class="row">
            <span class="row-icon" :class="{ ai: r.ai }"><AppIcon :name="r.icon" :size="19" /></span>
            <span class="row-main">
              <span class="row-title">
                {{ r.title }}<span v-if="r.login && !loggedIn" class="row-tag">需登录</span>
              </span>
              <span class="row-desc">{{ r.desc }}</span>
            </span>
            <span v-if="r.extra" class="row-extra num">{{ r.extra }}</span>
            <AppIcon name="chevronRight" :size="16" class="row-chev" />
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section class="group">
      <h2 class="group-title">设置</h2>
      <ul class="rows">
        <li class="row static">
          <span class="row-icon"><AppIcon name="theme" :size="19" /></span>
          <span class="row-main">
            <span id="theme-label" class="row-title">外观</span>
          </span>
          <ClientOnly>
            <div class="seg" role="group" aria-labelledby="theme-label">
              <button
                v-for="t in themes"
                :key="t.value"
                type="button"
                :aria-pressed="colorMode.preference === t.value"
                @click="colorMode.preference = t.value"
              >
                {{ t.label }}
              </button>
            </div>
          </ClientOnly>
        </li>
        <li v-if="user?.role === 'admin'">
          <NuxtLink to="/admin" class="row">
            <span class="row-icon"><AppIcon name="admin" :size="19" /></span>
            <span class="row-main">
              <span class="row-title">管理后台</span>
              <span class="row-desc">题目、用户、反馈和访问统计</span>
            </span>
            <AppIcon name="chevronRight" :size="16" class="row-chev" />
          </NuxtLink>
        </li>
        <li v-if="loggedIn">
          <button type="button" class="row logout" @click="logout">
            <span class="row-icon"><AppIcon name="logout" :size="19" /></span>
            <span class="row-main">
              <span class="row-title">退出登录</span>
            </span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 760px;
  padding-top: 40px;
  padding-bottom: 80px;
}

.me-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 20px;
}

.me-avatar {
  position: relative;
  display: inline-flex;
  flex: none;
  width: 68px;
  height: 68px;
}

.me-avatar circle:last-child {
  transition: stroke-dashoffset var(--dur-slow) var(--ease);
}

.avatar {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--c-ink);
  font-size: 22px;
  font-weight: 700;
  color: var(--c-on-ink);
}

.avatar.guest {
  background: var(--c-bg-mute);
  color: var(--c-text-2);
}

.who {
  flex: 1;
  min-width: 220px;
}

.who h1 {
  margin: 4px 0 0;
  font-size: clamp(26px, 4vw, 32px);
  font-weight: 800;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.auth {
  display: flex;
  gap: 10px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 28px;
}

.stats.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  color: var(--c-text-1);
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}

.stat:hover {
  border-color: var(--c-border);
  box-shadow: var(--shadow-sm);
}

.stat-num {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.15;
}

.stat-num small {
  margin-left: 2px;
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text-3);
}

.stat.hot .stat-num {
  color: var(--c-brand);
}

.stat-label {
  font-size: 13px;
  color: var(--c-text-2);
}

.group {
  margin-top: 36px;
}

.group-title {
  margin: 0 0 10px 4px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--c-text-3);
}

.rows {
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-lg);
  background: var(--c-bg-elv);
  list-style: none;
}

.rows > li + li {
  border-top: 1px solid var(--c-divider);
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 68px;
  padding: 12px 16px;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  color: var(--c-text-1);
  cursor: pointer;
  transition: background-color var(--dur-fast);
}

a.row:hover,
button.row:hover {
  background: var(--c-bg-soft);
}

.row.static {
  flex-wrap: wrap;
  cursor: default;
}

.row-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
  color: var(--c-text-1);
}

.row-icon.ai {
  background: var(--ai-grad);
  color: #fff;
}

.row-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
}

.row-tag {
  padding: 1px 7px;
  border-radius: var(--r-full);
  background: var(--c-bg-mute);
  font-size: 11px;
  font-weight: 500;
  color: var(--c-text-2);
}

.row-desc {
  font-size: 13px;
  color: var(--c-text-2);
}

.row-extra {
  flex: none;
  font-size: 13px;
  color: var(--c-text-2);
}

.row-chev {
  color: var(--c-text-3);
}

.logout .row-title {
  font-weight: 500;
  color: var(--c-danger);
}

.logout .row-icon {
  color: var(--c-danger);
}

.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--r-md);
  background: var(--c-bg-soft);
}

.seg button {
  min-height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: var(--r-sm);
  background: none;
  font: inherit;
  font-size: 13px;
  color: var(--c-text-2);
  cursor: pointer;
}

.seg button[aria-pressed='true'] {
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-xs);
  font-weight: 600;
  color: var(--c-text-1);
}

@media (max-width: 640px) {
  .page {
    padding-top: 28px;
  }

  .auth {
    width: 100%;
  }

  .auth .btn {
    flex: 1;
  }

  .stats:not(.three) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stat {
    padding: 14px 16px;
  }

  .stat-num {
    font-size: 24px;
  }

  .row-desc {
    font-size: 12px;
  }
}

@media (pointer: coarse) {
  .seg button {
    min-height: 40px;
  }
}
</style>
