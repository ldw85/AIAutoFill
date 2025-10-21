<script lang="ts">
  let count = 0;
  function increment() {
    count += 1;
  }
</script>

<style>
  main {
    width: 300px;
    padding: 1rem;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell,
      Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  }
  button {
    background: #2d6cdf;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
  }
</style>

<main>
  <h1>AIAutoFill</h1>
  <p>Svelte + TypeScript MV3 scaffold.</p>
  <button on:click={increment}>Clicked {count} {count === 1 ? 'time' : 'times'}</button>
</main>
