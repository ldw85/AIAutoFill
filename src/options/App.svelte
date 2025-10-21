<script lang="ts">
  let enabled = true;
</script>

<style>
  main {
    width: 600px;
    margin: 2rem auto;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell,
      Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  }
  label {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
</style>

<main>
  <h1>AIAutoFill Options</h1>
  <label>
    <input type="checkbox" bind:checked={enabled} /> Enabled
  </label>
</main>
