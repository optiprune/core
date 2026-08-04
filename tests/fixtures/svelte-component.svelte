<script>
  import { onMount } from 'svelte';
  import { count } from './store.js';

  let name = 'world';

  onMount(() => {
    console.log('Component mounted');
  });

  function increment() {
    count.update(n => n + 1);
  }
</script>

<h1>Hello {name}!</h1>
<button on:click={increment}>
  Count is {$count}
</button>
