<template>
  <div class="default-layout">
    <AppHeader />
    <main class="default-main">
      <slot />
    </main>
    <AppFooter />
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
</style>
