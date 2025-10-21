<script lang="ts">
  import { onMount } from 'svelte';
  import FAB from './FAB.svelte';
  import ManagementPanel from './ManagementPanel.svelte';
  import FieldBadge from './FieldBadge.svelte';
  import { ensureOverlayStyles } from './styles';
  import { panelOpen, candidatesView, keys } from './state';

  onMount(() => {
    ensureOverlayStyles();
  });
</script>

<div class="aiaf-overlay-root">
  <div class="aiaf-badges">
    {#each $candidatesView as cv}
      {#if cv.status || cv.applied}
        {#key cv.candidate.id}
          <FieldBadge
            candidate={cv.candidate}
            status={cv.status}
            label={cv.key?.label || cv.key?.key || 'field'}
            match={cv.best}
            value={$keys.find((k) => k.key.key === (cv.key?.key || ''))?.value}
          />
        {/key}
      {/if}
    {/each}
  </div>
  <FAB />
  {#if $panelOpen}
    <ManagementPanel />
  {/if}
</div>
