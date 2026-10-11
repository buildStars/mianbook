<script setup lang="ts">
/** 后台页面的标题区：小号标签 + 宋体标题 + 说明，右侧放操作按钮 */
defineProps<{
  eyebrow?: string
  title: string
  desc?: string
  back?: { to: string; label: string }
}>()
</script>

<template>
  <header class="a-head">
    <div class="a-head-text">
      <NuxtLink v-if="back" :to="back.to" class="a-back"><AdminIcon name="back" :size="15" />{{ back.label }}</NuxtLink>
      <p v-else-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h1 class="serif">{{ title }}</h1>
      <p v-if="desc || $slots.desc" class="a-head-desc">
        <slot name="desc">{{ desc }}</slot>
      </p>
    </div>
    <div v-if="$slots.default" class="a-head-actions">
      <slot />
    </div>
  </header>
</template>

<style scoped>
.a-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px 24px;
  margin-bottom: 24px;
}

.a-head-text {
  min-width: 0;
}

.eyebrow {
  margin-bottom: 6px;
}

h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: 0.01em;
}

.a-head-desc {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--c-text-2);
}

.a-back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin: 0 0 6px -3px;
  font-size: 13px;
  color: var(--c-text-2);
}

.a-back:hover {
  color: var(--c-brand);
}

.a-head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

@media (max-width: 640px) {
  h1 {
    font-size: 24px;
  }
}
</style>
