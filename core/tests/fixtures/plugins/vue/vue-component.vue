<template>
  <div class="counter">
    <h1>{{ title }}</h1>
    <button @click="increment">Count: {{ count }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps<{ title: string }>();
const count = ref(0);
const doubled = computed(() => count.value * 2);
const router = useRouter();

function increment() {
  count.value++;
}

export { doubled };
</script>

<style scoped>
.counter { padding: 1rem; }
</style>
