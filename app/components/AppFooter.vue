<script setup lang="ts">
const { outline, firstPathOf } = useOutline()
const { loggedIn, user } = useUserSession()
const searchOpen = useState('search-open', () => false)
</script>

<template>
  <footer class="app-footer">
    <div class="container inner">
      <div class="about">
        <NuxtLink to="/" class="brand">
          <span class="seal" aria-hidden="true">面</span>
          <span class="serif">全栈面试手册</span>
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
          <NuxtLink to="/progress">我的进度</NuxtLink>
          <NuxtLink to="/report">学习周报</NuxtLink>
          <button type="button" @click="searchOpen = true">搜索题目</button>
        </div>
        <div>
          <p class="col-title">账号</p>
          <template v-if="loggedIn">
            <span class="who">{{ user?.name }}</span>
            <NuxtLink v-if="user?.role === 'admin'" to="/admin">管理后台</NuxtLink>
          </template>
          <template v-else>
            <NuxtLink to="/login">登录</NuxtLink>
            <NuxtLink to="/register">注册</NuxtLink>
          </template>
        </div>
      </nav>
    </div>
    <div class="container">
      <div class="bottom">
        <span>© {{ new Date().getFullYear() }} 全栈面试手册</span>
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

.cols a:hover,
.cols button:hover {
  color: var(--c-text-1);
}

.who {
  color: var(--c-text-1);
  font-weight: 500;
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
