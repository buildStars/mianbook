<script setup lang="ts">
/**
 * 未登录时的行动按钮：主按钮去注册，旁边给已有账号的人一个登录入口，都带着 redirect 回到当前页。
 * 跳转前会触发 go，页面可以趁机把填了一半的内容暂存起来
 */
const props = withDefaults(defineProps<{ label?: string; ai?: boolean; redirect?: string }>(), { label: '免费注册' })
const emit = defineEmits<{ go: [] }>()

const route = useRoute()
const query = computed(() => ({ redirect: props.redirect ?? route.fullPath }))
</script>

<template>
  <div class="signup-prompt">
    <NuxtLink :to="{ path: '/register', query }" class="btn" :class="ai ? 'btn-ai' : 'btn-primary'" @click="emit('go')">
      <svg v-if="ai" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>
      {{ label }}
    </NuxtLink>
    <span class="login">已有账号？<NuxtLink :to="{ path: '/login', query }" @click="emit('go')">登录</NuxtLink></span>
  </div>
</template>

<style scoped>
.signup-prompt {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
}

.login {
  font-size: 14px;
  color: var(--c-text-2);
}

.login a {
  font-weight: 600;
  color: var(--c-brand);
}
</style>
