<script setup lang="ts">
const route = useRoute()
const { siteName, siteUrl } = useRuntimeConfig().public
const pageUrl = computed(() => `${siteUrl}${route.path}`)

// 页面只写自己的标题，站名统一在这里拼上；没有标题时只显示站名
useHead({
  titleTemplate: (title) => (title ? `${title} | ${siteName}` : siteName),
  link: [{ rel: 'canonical', href: pageUrl }],
})

// 分享卡片的默认值：题目页会换成自己的标题和描述
useSeoMeta({
  ogSiteName: siteName,
  ogType: 'website',
  ogLocale: 'zh_CN',
  ogUrl: pageUrl,
  ogTitle: `${siteName} · 把面试题讲成自己的话`,
  ogDescription: '前端、后端、AI 应用高频面试题详解，一句话回答、追问和易错点，读完再让 AI 面试官考你一遍',
  ogImage: `${siteUrl}/og.png`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: `${siteName}：把面试题讲成自己的话`,
  twitterCard: 'summary_large_image',
})
</script>

<template>
  <NuxtLoadingIndicator color="var(--c-brand)" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
