<script setup lang="ts">
import type { AppIconName } from '~/components/AppIcon.vue'

/**
 * 顶部导航右侧的"我的"：头像外圈是掌握进度，点开是个人面板（几个数字 + 全部个人入口）。
 * 未登录也能用：学习记录先存在本机，面板里提示登录。只在宽屏显示，窄屏直接去个人中心
 */
const { loggedIn, user, clear } = useUserSession()
const { starred, noted, mastered, total } = useCollection()
const { summary } = useReview()
const root = ref<HTMLElement | null>(null)
const { open, toggle, close } = usePopover(root)

const dueToday = computed(() => summary.value?.dueToday ?? 0)
const ring = computed(() => {
  const c = 2 * Math.PI * 16
  return { c, offset: c * (1 - (total.value ? mastered.value / total.value : 0)) }
})
const pct = computed(() => (total.value ? Math.round((mastered.value / total.value) * 100) : 0))

interface Link {
  to: string
  icon: AppIconName
  label: string
  extra?: string | number
}

const links = computed<Link[][]>(() => {
  const tools: Link[] = [{ to: '/connect', icon: 'connect', label: '接入 AI 工具' }]
  if (user.value?.role === 'admin') tools.push({ to: '/admin', icon: 'admin', label: '管理后台' })
  return [
    [
      { to: '/progress', icon: 'progress', label: '学习进度', extra: `${pct.value}%` },
      { to: '/favorites', icon: 'star', label: '我的收藏', extra: starred.value.length || '' },
      { to: '/favorites?tab=notes', icon: 'note', label: '我的笔记', extra: noted.value.length || '' },
      { to: '/report', icon: 'report', label: '学习周报' },
    ],
    tools,
  ]
})

async function logout() {
  close()
  await clear()
  await navigateTo('/')
}
</script>

<template>
  <div ref="root" class="acct">
    <button
      type="button"
      class="acct-btn"
      :class="{ open }"
      :aria-expanded="open"
      aria-controls="account-menu"
      :aria-label="`${loggedIn ? user?.name : '我的'}：个人菜单，已掌握 ${mastered} / ${total} 道`"
      @click="toggle"
    >
      <span class="ring">
        <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
          <circle cx="18" cy="18" r="16" fill="none" stroke="var(--c-divider)" stroke-width="2.5" />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            stroke="var(--st-mastered)"
            stroke-width="2.5"
            stroke-linecap="round"
            :stroke-dasharray="ring.c"
            :stroke-dashoffset="ring.offset"
            transform="rotate(-90 18 18)"
          />
        </svg>
        <span v-if="loggedIn" class="avatar">{{ user?.name?.slice(0, 1) }}</span>
        <span v-else class="avatar guest"><AppIcon name="user" :size="16" /></span>
      </span>
      <span class="acct-label">{{ loggedIn ? user?.name : '我的' }}</span>
      <AppIcon name="chevronDown" :size="14" class="chev" />
    </button>

    <Transition name="pop">
      <div v-if="open" id="account-menu" class="acct-panel">
        <div class="acct-head">
          <template v-if="loggedIn">
            <span class="avatar lg">{{ user?.name?.slice(0, 1) }}</span>
            <div class="who">
              <p class="who-name">
                {{ user?.name }}<span v-if="user?.role === 'admin'" class="tag">管理员</span>
              </p>
              <p class="who-sub">{{ user?.email }}</p>
            </div>
          </template>
          <template v-else>
            <span class="avatar lg guest"><AppIcon name="user" :size="20" /></span>
            <div class="who">
              <p class="who-name">还没有登录</p>
              <p class="who-sub wrap">记录先存在本机，登录后多设备同步</p>
            </div>
          </template>
        </div>

        <div class="stats" :class="{ three: !loggedIn }">
          <NuxtLink to="/progress" class="stat" @click="close">
            <span class="stat-num serif">{{ mastered }}</span>
            <span class="stat-label">已掌握</span>
          </NuxtLink>
          <NuxtLink to="/favorites" class="stat" @click="close">
            <span class="stat-num serif">{{ starred.length }}</span>
            <span class="stat-label">收藏</span>
          </NuxtLink>
          <NuxtLink to="/favorites?tab=notes" class="stat" @click="close">
            <span class="stat-num serif">{{ noted.length }}</span>
            <span class="stat-label">笔记</span>
          </NuxtLink>
          <NuxtLink v-if="loggedIn" to="/review" class="stat" :class="{ hot: dueToday }" @click="close">
            <span class="stat-num serif">{{ dueToday }}</span>
            <span class="stat-label">待复习</span>
          </NuxtLink>
        </div>

        <ul v-for="(group, i) in links" :key="i" class="list">
          <li v-for="l in group" :key="l.to">
            <NuxtLink :to="l.to" class="item" @click="close">
              <AppIcon :name="l.icon" />
              <span>{{ l.label }}</span>
              <span v-if="l.extra" class="item-extra num">{{ l.extra }}</span>
            </NuxtLink>
          </li>
        </ul>

        <div class="acct-foot">
          <NuxtLink to="/me" class="foot-link" @click="close">
            个人中心<AppIcon name="arrowRight" :size="14" />
          </NuxtLink>
          <button v-if="loggedIn" type="button" class="foot-btn" @click="logout">
            <AppIcon name="logout" :size="16" />退出登录
          </button>
          <div v-else class="foot-auth">
            <NuxtLink to="/register" class="btn btn-sm" @click="close">注册</NuxtLink>
            <NuxtLink to="/login" class="btn btn-sm btn-primary" @click="close">登录</NuxtLink>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.acct {
  position: relative;
}

.acct-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 8px 0 4px;
  border: none;
  border-radius: var(--r-full);
  background: none;
  font: inherit;
  color: var(--c-text-1);
  cursor: pointer;
  transition: background-color var(--dur);
}

.acct-btn:hover,
.acct-btn.open {
  background: var(--c-default-soft);
}

.ring {
  position: relative;
  display: inline-flex;
  width: 36px;
  height: 36px;
}

.ring circle:last-child {
  transition: stroke-dashoffset var(--dur-slow) var(--ease);
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--c-ink);
  font-size: 13px;
  font-weight: 700;
  color: var(--c-on-ink);
}

.ring .avatar {
  position: absolute;
  top: 4px;
  left: 4px;
}

.avatar.guest {
  background: var(--c-bg-mute);
  color: var(--c-text-2);
}

.avatar.lg {
  width: 44px;
  height: 44px;
  font-size: 18px;
}

.acct-label {
  max-width: 96px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chev {
  color: var(--c-text-3);
  transition: transform var(--dur) var(--ease);
}

.acct-btn.open .chev {
  transform: rotate(180deg);
}

.acct-panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 42;
  width: 320px;
  padding: 8px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-xl);
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-lg);
}

.acct-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px 14px;
}

.who {
  min-width: 0;
}

.who-name {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--c-text-1);
}

.who-name .tag {
  font-weight: 500;
}

.who-sub {
  margin: 2px 0 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.who-sub.wrap {
  line-height: 1.6;
  white-space: normal;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin: 0 4px 6px;
  padding: 4px;
  border-radius: var(--r-lg);
  background: var(--c-bg-soft);
}

.stats.three {
  grid-template-columns: repeat(3, 1fr);
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0 7px;
  border-radius: var(--r-md);
  color: var(--c-text-1);
  transition: background-color var(--dur-fast);
}

.stat:hover {
  background: var(--c-bg-elv);
}

.stat-num {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
}

.stat.hot .stat-num {
  color: var(--c-brand);
}

.stat-label {
  font-size: 12px;
  color: var(--c-text-3);
}

.list {
  margin: 0;
  padding: 6px 0;
  list-style: none;
}

.list + .list {
  border-top: 1px solid var(--c-divider);
}

.item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  padding: 0 12px;
  border-radius: var(--r-md);
  font-size: 14px;
  color: var(--c-text-1);
  transition: background-color var(--dur-fast);
}

.item:hover {
  background: var(--c-default-soft);
}

.item .app-icon {
  color: var(--c-text-2);
}

.item-extra {
  margin-left: auto;
  font-size: 12px;
  color: var(--c-text-3);
}

.acct-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
  padding: 10px 4px 2px 12px;
  border-top: 1px solid var(--c-divider);
}

.foot-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-brand);
}

.foot-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--r-sm);
  background: none;
  font: inherit;
  font-size: 13px;
  color: var(--c-text-2);
  cursor: pointer;
}

.foot-btn:hover {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.foot-auth {
  display: flex;
  gap: 6px;
}

.pop-enter-active,
.pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
