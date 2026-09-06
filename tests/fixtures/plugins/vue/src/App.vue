<script setup lang="ts">
import { computed, ref } from 'vue';
import ChildCard from './components/ChildCard.vue';

const count = ref(0);
const label = computed(() => `Count: ${count.value}`);
</script>

<template>
  <main class="app"><ChildCard :label="label" @increment="count++" /></main>
</template>

<style scoped>
.app { padding: 1rem; }
</style>
