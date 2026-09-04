<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { SvelteComponent } from 'svelte';

  let count = $state(0);
  let doubled = $derived(count * 2);

  export function reset() {
    count = 0;
  }

  onMount(() => {
    console.log('mounted');
  });
</script>

<h1>Count: {count}</h1>
<p>Doubled: {doubled}</p>
<button onclick={() => count++}>Increment</button>
