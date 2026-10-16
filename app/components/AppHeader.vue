<script setup lang="ts">
defineProps<{ withMenu?: boolean }>()

const route = useRoute()
const { outline, all, firstPathOf } = useOutline()
const { records } = useStudy()
const { loggedIn, user, clear } = useUserSession()
const { summary } = useReview()
const dueToday = computed(() => summary.value?.dueToday ?? 0)
const colorMode = useColorMode()
const searchOpen = useState('search-open', () => false)
const sidebarOpen = useState('sidebar-open', () => false)

// 在登录、注册页上点"登录"时不要把当前页再套进 redirect
const loginLink = computed(() =>
  ['/login', '/register'].includes(route.path) ? route.fullPath : `/login?redirect=${encodeURIComponent(route.fullPath)}`,
)

const isDark = computed(() => colorMode.value === 'dark')
const toggleTheme = () => (colorMode.preference = isDark.value ? 'light' : 'dark')

/** 进度入口上的小圆环：已掌握 / 总题数 */
const mastered = computed(() => all.value.filter((q) => records.value[q.id]?.status === 'mastered').length)
const ring = computed(() => {
  const c = 2 * Math.PI * 8
  const pct = all.value.length ? mastered.value / all.value.length : 0
  return { c, offset: c * (1 - pct) }
})

async function logout() {
  await clear()
  await navigateTo('/')
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchOpen.value = true
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <header class="app-header">
    <div class="inner">
      <button
        v-if="withMenu"
        type="button"
        class="icon-btn menu-btn"
        :aria-label="sidebarOpen ? '关闭目录' : '打开目录'"
        :aria-expanded="sidebarOpen"
        @click="sidebarOpen = !sidebarOpen"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h10M4 17h16" /></svg>
      </button>

      <NuxtLink to="/" class="brand" aria-label="全栈面试手册首页">
        <span class="seal" aria-hidden="true">面</span>
        <span class="brand-text">全栈面试手册</span>
      </NuxtLink>

      <nav class="nav" aria-label="题库分区">
        <NuxtLink
          v-for="part in outline"
          :key="part.id"
          :to="firstPathOf(part)"
          :class="{ active: route.path.startsWith(`/${part.slug}/`) }"
        >
          {{ part.title }}
        </NuxtLink>
        <span class="nav-sep" aria-hidden="true" />
        <NuxtLink to="/review" :class="{ active: route.path === '/review' }">
          复习<span v-if="dueToday" class="nav-badge" :aria-label="`今天待复习 ${dueToday} 道`">{{ dueToday > 99 ? '99+' : dueToday }}</span>
        </NuxtLink>
        <NuxtLink to="/mock" :class="{ active: route.path.startsWith('/mock') }">模拟面试</NuxtLink>
        <NuxtLink to="/ask" :class="{ active: route.path === '/ask' }">问手册</NuxtLink>
      </nav>

      <div class="right">
        <button type="button" class="search-btn" aria-label="搜索题目" @click="searchOpen = true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span class="search-text">搜索题目</span>
          <span class="search-keys"><kbd>Ctrl</kbd><kbd>K</kbd></span>
        </button>

        <NuxtLink
          to="/progress"
          class="progress-link"
          :class="{ active: route.path === '/progress' }"
          title="我的进度"
          :aria-label="`我的进度：已掌握 ${mastered} / ${all.length}`"
        >
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--c-divider)" stroke-width="3" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="var(--st-mastered)"
              stroke-width="3"
              stroke-linecap="round"
              :stroke-dasharray="ring.c"
              :stroke-dashoffset="ring.offset"
              transform="rotate(-90 10 10)"
            />
          </svg>
          <span class="progress-text">我的进度</span>
        </NuxtLink>

        <ClientOnly>
          <button type="button" class="icon-btn" :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'" @click="toggleTheme">
            <svg v-if="isDark" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
          </button>
          <template #fallback><span class="icon-btn" /></template>
        </ClientOnly>

        <ElDropdown v-if="loggedIn" trigger="click" placement="bottom-end">
          <button type="button" class="user-btn" :title="user?.email">
            <span class="avatar">{{ user?.name?.slice(0, 1) }}</span>
            <span class="user-name">{{ user?.name }}</span>
          </button>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem @click="navigateTo('/progress')">我的进度</ElDropdownItem>
              <ElDropdownItem @click="navigateTo('/review')">今日复习{{ dueToday ? `（${dueToday}）` : '' }}</ElDropdownItem>
              <ElDropdownItem @click="navigateTo('/mock')">模拟面试</ElDropdownItem>
              <ElDropdownItem @click="navigateTo('/ask')">问手册</ElDropdownItem>
              <ElDropdownItem @click="navigateTo('/report')">学习周报</ElDropdownItem>
              <ElDropdownItem v-if="user?.role === 'admin'" @click="navigateTo('/admin')">管理后台</ElDropdownItem>
              <ElDropdownItem divided @click="logout">退出登录</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
        <NuxtLink v-else :to="loginLink" class="btn btn-sm btn-primary login-btn">登录</NuxtLink>
      </div>
    </div>
  </header>
  <SearchDialog v-model:open="searchOpen" />
</template>

<style scoped>
.app-header {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 40;
  height: var(--header-h);
  border-bottom: 1px solid var(--c-divider);
  background: color-mix(in srgb, var(--c-bg) 86%, transparent);
  backdrop-filter: saturate(180%) blur(14px);
}

.inner {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 100%;
  padding: 0 20px;
}

.brand {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  margin-right: 20px;
  color: var(--c-text-1);
}

.brand-text {
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.nav {
  display: none;
  align-self: stretch;
  gap: 4px;
}

.nav a {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text-2);
  white-space: nowrap;
  transition: color var(--dur);
}

.nav a::after {
  content: '';
  position: absolute;
  right: 12px;
  bottom: -1px;
  left: 12px;
  height: 2px;
  border-radius: 2px;
  background: var(--c-brand);
  transform: scaleX(0);
  transition: transform var(--dur) var(--ease);
}

.nav a:hover {
  color: var(--c-text-1);
}

.nav a.active {
  color: var(--c-text-1);
}

.nav a.active::after {
  transform: scaleX(1);
}

.nav-sep {
  align-self: center;
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--c-divider);
}

.nav-badge {
  min-width: 18px;
  height: 18px;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: var(--r-full);
  background: var(--c-seal);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  color: #fff;
}

.right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.search-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 40px;
  height: 38px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  background: none;
  color: var(--c-text-2);
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color var(--dur),
    background-color var(--dur);
}

.search-btn:hover {
  background: var(--c-default-soft);
}

.search-text,
.search-keys {
  display: none;
}

.search-keys {
  gap: 3px;
  margin-left: auto;
}

.progress-link {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 9px;
  border-radius: var(--r-md);
  color: var(--c-text-2);
  font-size: 14px;
  font-weight: 500;
  transition: background-color var(--dur);
}

.progress-link:hover,
.progress-link.active {
  background: var(--c-default-soft);
  color: var(--c-text-1);
}

.progress-link circle:last-child {
  transition: stroke-dashoffset var(--dur-slow) var(--ease);
}

.progress-text {
  display: none;
}

.icon-btn {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: var(--r-md);
  background: none;
  color: var(--c-text-2);
  cursor: pointer;
  transition:
    background-color var(--dur),
    color var(--dur);
}

.icon-btn:hover {
  background: var(--c-default-soft);
  color: var(--c-text-1);
}

.menu-btn {
  margin-left: -8px;
}

.login-btn {
  margin-left: 4px;
}

.user-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 10px 0 4px;
  border: none;
  border-radius: var(--r-full);
  background: none;
  cursor: pointer;
}

.user-btn:hover {
  background: var(--c-default-soft);
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--c-ink);
  color: var(--c-on-ink);
  font-size: 13px;
  font-weight: 700;
}

.user-name {
  display: none;
  max-width: 96px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 420px) {
  .brand-text {
    font-size: 16px;
  }

  .inner {
    gap: 6px;
    padding: 0 12px;
  }

  .brand {
    gap: 8px;
    margin-right: 0;
  }

  .right {
    gap: 0;
  }

  .search-btn,
  .icon-btn {
    width: 34px;
  }

  .search-btn {
    padding: 0 9px;
  }

  .progress-link {
    padding: 0 7px;
  }
}

@media (min-width: 768px) {
  .search-btn {
    width: 220px;
    border-color: var(--c-divider);
    background: var(--c-bg-elv);
  }

  .search-btn:hover {
    border-color: var(--c-border);
    background: var(--c-bg-elv);
  }

  .search-text,
  .search-keys {
    display: inline-flex;
  }

  .progress-text {
    display: inline;
  }
}

@media (min-width: 960px) {
  .menu-btn {
    display: none;
  }

  .nav {
    display: flex;
  }

  .user-name {
    display: inline;
  }
}

@media (min-width: 960px) and (max-width: 1180px) {
  .search-btn {
    width: 40px;
    border-color: transparent;
    background: none;
  }

  .search-text,
  .search-keys {
    display: none;
  }
}
</style>
