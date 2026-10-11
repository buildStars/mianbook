<script setup lang="ts">
import '~/assets/css/admin.css'
import type { AdminIconName } from '~/components/admin/Icon.vue'

const route = useRoute()
const { user, clear } = useUserSession()

const groups: { label: string; items: { path: string; label: string; icon: AdminIconName }[] }[] = [
  { label: '运营', items: [{ path: '/admin', label: '概览', icon: 'dashboard' }] },
  {
    label: '内容',
    items: [
      { path: '/admin/questions', label: '题目', icon: 'questions' },
      { path: '/admin/structure', label: '分类', icon: 'folder' },
    ],
  },
  {
    label: '系统',
    items: [
      { path: '/admin/users', label: '用户', icon: 'users' },
      { path: '/admin/ai', label: 'AI 设置', icon: 'sparkle' },
    ],
  },
]

const isActive = (path: string) => (path === '/admin' ? route.path === '/admin' : route.path.startsWith(path))

// 内容同步状态：有 content 目录时，后台的修改会写回 Markdown 文件
const { data: settings } = useFetch<{ contentSync: boolean }>('/api/admin/settings', { key: 'admin-settings' })

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
        <span class="brand-name serif">面试手册</span>
        <span class="brand-tag">后台</span>
      </NuxtLink>

      <nav aria-label="后台导航">
        <div v-for="g in groups" :key="g.label" class="group">
          <p class="group-label">{{ g.label }}</p>
          <NuxtLink
            v-for="item in g.items"
            :key="item.path"
            :to="item.path"
            :class="{ active: isActive(item.path) }"
            :aria-current="isActive(item.path) ? 'page' : undefined"
          >
            <AdminIcon :name="item.icon" />{{ item.label }}
          </NuxtLink>
        </div>
      </nav>

      <div class="foot">
        <p
          v-if="settings"
          class="sync"
          :class="{ on: settings.contentSync }"
          :title="settings.contentSync ? '后台的修改会同时写回 content/ 下的 Markdown 文件' : '没有 content 目录，修改只保存在数据库'"
        >
          <AdminIcon :name="settings.contentSync ? 'sync' : 'database'" :size="15" />
          {{ settings.contentSync ? '同步到 content/' : '仅保存到数据库' }}
        </p>
        <div class="me">
          <span class="avatar serif" aria-hidden="true">{{ user?.name?.slice(0, 1) }}</span>
          <span class="me-text">
            <strong>{{ user?.name }}</strong>
            <span>{{ user?.email }}</span>
          </span>
        </div>
        <div class="foot-links">
          <NuxtLink to="/" class="foot-link"><AdminIcon name="home" :size="15" />返回前台</NuxtLink>
          <button type="button" class="foot-link" @click="logout"><AdminIcon name="logout" :size="15" />退出</button>
        </div>
      </div>
    </aside>

    <main class="main">
      <div class="main-inner">
        <slot />
      </div>
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
  width: 232px;
  height: 100vh;
  padding: 22px 14px 16px;
  border-right: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 22px;
  color: var(--c-text-1);
}

.brand .seal {
  width: 28px;
  height: 28px;
  font-size: 16px;
}

.brand-name {
  font-size: 17px;
  font-weight: 700;
}

.brand-tag {
  padding: 2px 7px;
  border-radius: var(--r-xs);
  background: var(--c-ink);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--c-on-ink);
}

nav {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.group-label {
  margin: 0 0 4px;
  padding: 0 12px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--c-text-3);
}

nav a {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 12px;
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

nav a.active .a-icon {
  color: var(--c-brand);
}

nav a.active::before {
  content: '';
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: -14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--c-brand);
}

.foot {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--c-divider);
}

.sync {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 6px;
  height: 26px;
  margin: 0;
  padding: 0 10px;
  border-radius: var(--r-full);
  background: var(--c-default-soft);
  font-size: 12px;
  color: var(--c-text-2);
}

.sync.on {
  background: var(--c-success-soft);
  color: var(--c-success);
}

.me {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0 2px;
}

.avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--c-ink);
  font-size: 15px;
  font-weight: 700;
  color: var(--c-on-ink);
}

.me-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 13px;
  line-height: 1.4;
}

.me-text span {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-3);
}

.foot-links {
  display: flex;
  gap: 4px;
}

.foot-link {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--c-divider);
  border-radius: var(--r-sm);
  background: var(--c-bg-elv);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--c-text-2);
  cursor: pointer;
}

.foot-link:hover {
  border-color: var(--c-border);
  color: var(--c-text-1);
}

.main {
  flex: 1;
  min-width: 0;
  padding: 32px 40px 72px;
}

.main-inner {
  max-width: 1280px;
  margin: 0 auto;
}

/* 窄屏：侧栏变成顶部的横向导航 */
@media (max-width: 860px) {
  .admin {
    flex-direction: column;
  }

  .side {
    position: sticky;
    z-index: 20;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    width: 100%;
    height: auto;
    padding: 10px 16px 0;
    border-right: none;
    border-bottom: 1px solid var(--c-divider);
  }

  .brand {
    padding: 0 0 10px;
  }

  nav {
    flex-direction: row;
    order: 3;
    gap: 2px;
    width: calc(100% + 32px);
    margin: 0 -16px;
    padding: 0 12px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .group {
    flex-direction: row;
  }

  .group-label {
    display: none;
  }

  nav a {
    flex: none;
    height: 40px;
    padding: 0 10px;
    border-radius: 0;
    background: none !important;
    box-shadow: none !important;
  }

  nav a.active::before {
    top: auto;
    right: 10px;
    bottom: 0;
    left: 10px;
    width: auto;
    height: 2px;
    border-radius: 2px 2px 0 0;
  }

  .foot {
    flex-direction: row;
    align-items: center;
    margin: 0 0 10px auto;
    padding: 0;
    border: none;
  }

  .sync,
  .me {
    display: none;
  }

  .foot-link {
    flex: none;
    border: none;
    background: none;
    padding: 0 6px;
  }

  .main {
    padding: 20px 16px 56px;
  }
}
</style>
