<script setup lang="ts">
// 页面只写自己的标题，站名统一在这里拼上；没有标题时只显示站名
const siteName = useRuntimeConfig().public.siteName
useHead({ titleTemplate: (title) => (title ? `${title} | ${siteName}` : siteName) })
</script>

<template>
  <NuxtLoadingIndicator color="var(--c-brand)" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
