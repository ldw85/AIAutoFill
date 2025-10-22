<script lang="ts">
  import type { Candidate } from '../domScanner';
  import type { UIStatus } from './state';
  import { getElementForCandidate, applyCandidate, undoCandidate, isApplied } from './state';
  import type { MatchResult } from '../../lib/fieldMatcher';
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';

  export let candidate: Candidate;
  export let label: string;
  export let status: UIStatus | undefined;
  export let match: MatchResult | undefined;
  export let value: unknown;

  const pos = writable<{ top: number; left: number } | null>(null);
  const applied = writable<boolean>(false);

  let observer: ResizeObserver | null = null;
  let scrollHandler: () => void;

  function updatePosition() {
    const el = getElementForCandidate(candidate);
    if (!el) return;
    const r = el.getBoundingClientRect();
    pos.set({ top: r.top, left: r.left });
    applied.set(isApplied(candidate.id));
  }

  function onClick() {
    if (!match) return;
    if (isApplied(candidate.id)) {
      undoCandidate(candidate);
      updatePosition();
      return;
    }
    if (value == null) return;
    applyCandidate(candidate, match, value);
    updatePosition();
  }

  onMount(() => {
    updatePosition();
    observer = new ResizeObserver(() => updatePosition());
    const el = getElementForCandidate(candidate);
    if (el) observer.observe(el);
    scrollHandler = () => updatePosition();
    window.addEventListener('scroll', scrollHandler, true);
    window.addEventListener('resize', scrollHandler, true);
  });
  onDestroy(() => {
    if (observer) observer.disconnect();
    window.removeEventListener('scroll', scrollHandler, true);
    window.removeEventListener('resize', scrollHandler, true);
  });
</script>

{#if pos}
  <button class="aiaf-badge {status || ''}"
       style="top: {pos.top - 6}px; left: {pos.left - 6}px;"
       type="button"
       title={label}
       on:click|stopPropagation|preventDefault={onClick}>
    <span class="dot"></span>
    <span>{label}</span>
    {#if $applied}
      <span>Undo</span>
    {:else}
      <span>Fill</span>
    {/if}
  </button>
{/if}
