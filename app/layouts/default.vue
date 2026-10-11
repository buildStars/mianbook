<template>
  <div class="default-layout">
    <AppHeader />
    <main class="default-main">
      <slot />
    </main>
    <AppFooter />
    <AppTabBar />
  </div>
</template>

<style scoped>
.default-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.default-main {
  flex: 1;
  padding-top: var(--header-h);
}

/* 窄屏底部有标签栏，留出位置，避免挡住页脚 */
@media (max-width: 959px) {
  .default-layout {
    padding-bottom: calc(61px + env(safe-area-inset-bottom));
  }
}
</style>
