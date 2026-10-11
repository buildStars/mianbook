<script setup lang="ts">
const route = useRoute()
const { user, clear } = useUserSession()

const menu = [
  { path: '/admin', label: '概览' },
  { path: '/admin/questions', label: '题目管理' },
  { path: '/admin/structure', label: '分类管理' },
  { path: '/admin/users', label: '用户' },
  { path: '/admin/ai', label: 'AI 设置' },
]

const isActive = (path: string) => (path === '/admin' ? route.path === '/admin' : route.path.startsWith(path))

async function logout() {
  await clear()
  await navigateTo('/')
}
</script>

<template>
  <div class="admin">
    <aside class="side">
      <NuxtLink to="/admin" class="brand">
        <span class="seal" aria-hidden="true">面</span>
        <span class="serif">面试手册</span>
        <span class="brand-tag">后台</span>
      </NuxtLink>
      <nav>
        <NuxtLink v-for="item in menu" :key="item.path" :to="item.path" :class="{ active: isActive(item.path) }">
          {{ item.label }}
        </NuxtLink>
      </nav>
      <div class="foot">
        <p class="user">{{ user?.name }}<span>{{ user?.email }}</span></p>
        <NuxtLink to="/">返回前台</NuxtLink>
        <button type="button" @click="logout">退出登录</button>
      </div>
    </aside>
    <main class="main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.admin {
  display: flex;
  min-height: 100vh;
  background: var(--c-bg);
}

.side {
  position: sticky;
  top: 0;
  display: flex;
  flex: none;
  flex-direction: column;
  width: 220px;
  height: 100vh;
  padding: 20px 12px;
  border-right: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 24px;
  font-size: 16px;
  font-weight: 700;
  color: var(--c-text-1);
}

.brand .seal {
  width: 28px;
  height: 28px;
  font-size: 16px;
}

.brand-tag {
  padding: 1px 7px;
  border-radius: var(--r-xs);
  background: var(--c-ink);
  font-size: 11px;
  font-weight: 600;
  color: var(--c-on-ink);
}

nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

nav a {
  position: relative;
  padding: 9px 12px;
  border-radius: var(--r-sm);
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text-2);
  transition:
    background-color var(--dur-fast),
    color var(--dur-fast);
}

nav a:hover {
  background: var(--c-default-soft);
  color: var(--c-text-1);
}

nav a.active {
  background: var(--c-bg-elv);
  box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--c-divider);
  font-weight: 600;
  color: var(--c-text-1);
}

nav a.active::before {
  content: '';
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: -1px;
  width: 3px;
  border-radius: 3px;
  background: var(--c-brand);
}

.foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding: 12px 10px 0;
  border-top: 1px solid var(--c-divider);
  font-size: 13px;
}

.user {
  display: flex;
  flex-direction: column;
  margin: 0;
  font-weight: 600;
}

.user span {
  overflow: hidden;
  font-weight: 400;
  text-overflow: ellipsis;
  color: var(--c-text-3);
}

.foot button {
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  color: var(--c-text-2);
  cursor: pointer;
}

.main {
  flex: 1;
  min-width: 0;
  padding: 28px 32px 64px;
}

@media (max-width: 760px) {
  .admin {
    flex-direction: column;
  }

  .side {
    position: static;
    width: 100%;
    height: auto;
  }

  nav {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .main {
    padding: 20px 16px 48px;
  }
}
</style>
