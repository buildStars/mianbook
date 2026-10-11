<script setup lang="ts">
const props = defineProps<{ title: string }>()
const segments = computed(() => titleSegments(props.title))
</script>

<template>
  <span class="rich-title"><template v-for="(s, i) in segments" :key="i"><code v-if="s.code">{{ s.text }}</code><template v-else>{{ s.text }}</template></template></span>
</template>

<style scoped>
.rich-title code {
  padding: 0 0.25em;
  border-radius: 4px;
  background: var(--c-default-soft);
  font-family: var(--font-mono);
  font-size: 0.85em;
}
</style>
