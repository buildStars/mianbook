<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const title = computed(() => {
  if (props.error.statusCode === 404) return '这一页没有找到'
  if (props.error.statusCode === 403) return '没有权限访问'
  return '出了点问题'
})

const searchOpen = useState('search-open', () => false)
</script>

<template>
  <NuxtLayout name="default">
    <div class="error-page container">
      <p class="code serif" aria-hidden="true">{{ error.statusCode }}</p>
      <h1 class="serif">{{ title }}</h1>
      <p class="message">{{ error.statusMessage || error.message }}</p>
      <div class="actions">
        <button type="button" class="btn btn-primary" @click="clearError({ redirect: '/' })">回到首页</button>
        <button type="button" class="btn" @click="searchOpen = true">搜索题目</button>
      </div>
    </div>
  </NuxtLayout>
</template>

<style scoped>
.error-page {
  padding-top: 96px;
  text-align: center;
}

.code {
  margin: 0;
  font-size: clamp(96px, 16vw, 160px);
  font-weight: 900;
  line-height: 1;
  color: transparent;
  -webkit-text-stroke: 2px var(--c-text-3);
}

h1 {
  margin: 16px 0 0;
  font-size: 30px;
  font-weight: 800;
}

.message {
  margin: 10px 0 0;
  color: var(--c-text-2);
}

.actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}
</style>
