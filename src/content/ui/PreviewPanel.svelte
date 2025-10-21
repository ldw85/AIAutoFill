<script lang="ts">
  import { panelOpen, keys, batch, applyAll, undoAll, applyCandidate, undoCandidate } from './state';
  import type { BatchMatchResult, MatchResult } from '../../lib/fieldMatcher';
  import { get } from 'svelte/store';

  function close() { panelOpen.set(false); }

  function bestForKey(b: BatchMatchResult | null, key: string): MatchResult | undefined {
    if (!b) return undefined;
    const arr = b.byKey[key] || [];
    return arr[0];
  }

  function applyOne(m: MatchResult) {
    const list = get(keys);
    const kc = list.find((k) => k.key.key === m.key.key);
    if (!kc || kc.value == null) return;
    applyCandidate(m.candidate, m, kc.value);
  }
  function undoOne(m: MatchResult) {
    undoCandidate(m.candidate);
  }
</script>

<div class="aiaf-panel" role="dialog" aria-label="AIAutoFill Preview">
  <header>
    <strong>AIAutoFill Preview</strong>
    <button on:click={close}>×</button>
  </header>
  <div class="body">
    {#each $keys as kc}
      {#if bestForKey($batch, kc.key.key)}
        {#key kc.key.key}
          <div class="row">
            <div>
              <div class="key">{kc.key.label || kc.key.key}</div>
              <div class="target">→ {bestForKey($batch, kc.key.key)?.candidate.accessibleName?.value || bestForKey($batch, kc.key.key)?.candidate.attributes?.placeholder || bestForKey($batch, kc.key.key)?.candidate.attributes?.name || bestForKey($batch, kc.key.key)?.candidate.tagName}</div>
            </div>
            <div class="score">{(bestForKey($batch, kc.key.key)?.score || 0).toFixed(2)} {bestForKey($batch, kc.key.key)?.tier}</div>
            <div>
              <button class="primary" on:click={() => { const m = bestForKey($batch, kc.key.key); if (m) applyOne(m); }}>Apply</button>
              <button on:click={() => { const m = bestForKey($batch, kc.key.key); if (m) undoOne(m); }}>Undo</button>
            </div>
          </div>
        {/key}
      {/if}
    {/each}
  </div>
  <footer>
    <button on:click={() => applyAll()}>Apply All</button>
    <button on:click={() => undoAll()}>Undo All</button>
  </footer>
</div>
