<script setup lang="ts">
const { outline, firstPathOf } = useOutline()
const { loggedIn, user } = useUserSession()
const searchOpen = useState('search-open', () => false)
const siteName = useRuntimeConfig().public.siteName
</script>

<template>
  <footer class="app-footer">
    <div class="container inner">
      <div class="about">
        <NuxtLink to="/" class="brand">
          <BrandSeal :size="30" />
          <span class="serif">{{ siteName }}</span>
        </NuxtLink>
        <p>把高频面试题讲成自己的话。<br>先想、再看、被追问、再复习。</p>
      </div>
      <nav class="cols" aria-label="页脚导航">
        <div>
          <p class="col-title">题库</p>
          <NuxtLink v-for="part in outline" :key="part.id" :to="firstPathOf(part)">{{ part.title }}</NuxtLink>
        </div>
        <div>
          <p class="col-title">学习</p>
          <NuxtLink to="/review">今日复习</NuxtLink>
          <NuxtLink to="/mock">模拟面试</NuxtLink>
          <NuxtLink to="/practice">默写练习</NuxtLink>
          <NuxtLink to="/ask">问手册</NuxtLink>
          <NuxtLink to="/connect">接入 AI 工具</NuxtLink>
          <button type="button" @click="searchOpen = true">搜索题目</button>
        </div>
        <div>
          <p class="col-title">我的</p>
          <NuxtLink to="/me">个人中心</NuxtLink>
          <NuxtLink to="/progress">学习进度</NuxtLink>
          <NuxtLink to="/favorites">我的收藏</NuxtLink>
          <NuxtLink to="/report">学习周报</NuxtLink>
          <NuxtLink v-if="user?.role === 'admin'" to="/admin">管理后台</NuxtLink>
          <template v-if="!loggedIn">
            <NuxtLink to="/login">登录</NuxtLink>
            <NuxtLink to="/register">注册</NuxtLink>
          </template>
        </div>
      </nav>
    </div>
    <div class="container">
      <div class="bottom">
        <span>© {{ new Date().getFullYear() }} {{ siteName }} · mianbook.ink</span>
        <span>内容持续更新 · 学习记录登录后多端同步</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.app-footer {
  margin-top: 96px;
  border-top: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
  font-size: 14px;
}

.inner {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 40px;
  padding-top: 48px;
  padding-bottom: 40px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 700;
  color: var(--c-text-1);
}

.about p {
  margin: 14px 0 0;
  line-height: 1.8;
  color: var(--c-text-2);
}

.cols {
  display: flex;
  flex-wrap: wrap;
  gap: 32px 64px;
}

.cols div {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.col-title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--c-text-3);
}

.cols a,
.cols button {
  padding: 0;
  border: none;
  background: none;
  color: var(--c-text-2);
  font-size: 14px;
  cursor: pointer;
  transition: color var(--dur);
}

/* 触屏设备上链接本身做到 44px 高，行距靠它撑开 */
@media (pointer: coarse) {
  .cols div {
    gap: 0;
  }

  .cols a,
  .cols button {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
}

.cols a:hover,
.cols button:hover {
  color: var(--c-text-1);
}

.bottom {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  padding-top: 18px;
  padding-bottom: 28px;
  border-top: 1px solid var(--c-divider);
  font-size: 13px;
  color: var(--c-text-3);
}
</style>
