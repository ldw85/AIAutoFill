<script lang="ts">
  import { panelOpen } from './state';
  import { get } from 'svelte/store';

  function toggle() {
    panelOpen.set(!get(panelOpen));
  }
</script>

<button class="aiaf-fab" type="button" aria-label="AIAutoFill panel" title="AIAutoFill" on:click|stopPropagation|preventDefault={toggle}>
  AI
</button>
