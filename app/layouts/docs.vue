<script setup lang="ts">
const sidebarOpen = useState('sidebar-open', () => false)
const route = useRoute()
watch(
  () => route.path,
  () => (sidebarOpen.value = false),
)
</script>

<template>
  <div class="docs-layout">
    <AppHeader />
    <Transition name="fade">
      <div v-if="sidebarOpen" class="backdrop" @click="sidebarOpen = false" />
    </Transition>
    <DocsSidebar :class="{ open: sidebarOpen }" />
    <div class="docs-main">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.docs-main {
  padding-top: var(--header-h);
}

.backdrop {
  position: fixed;
  inset: var(--header-h) 0 0 0;
  z-index: 29;
  background: rgba(20, 18, 15, 0.42);
  backdrop-filter: blur(2px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-slow) var(--ease);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (min-width: 960px) {
  .docs-main {
    padding-left: var(--sidebar-w);
  }

  .backdrop {
    display: none;
  }
}
</style>
