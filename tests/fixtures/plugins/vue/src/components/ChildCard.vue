<script setup lang="ts">
defineProps<{ label: string }>();
defineEmits<{ increment: [] }>();
</script>

<template><button @click="$emit('increment')">{{ label }}</button></template>
