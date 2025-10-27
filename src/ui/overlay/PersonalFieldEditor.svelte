<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { PersonalFieldCandidate, PersonalFieldKey } from '../../content/extract/personal';

  export let def: { key: PersonalFieldKey; label: string };
  export let value = '';
  export let candidate: PersonalFieldCandidate | undefined;
  export let candidates: PersonalFieldCandidate[] = [];

  const dispatch = createEventDispatcher<{ change: string; suggestion: PersonalFieldCandidate }>();

  function handleInput(event: Event) {
    const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement | null;
    if (!target) return;
    dispatch('change', target.value);
  }

  function applyCandidate(option: PersonalFieldCandidate) {
    dispatch('suggestion', option);
  }
</script>

<div class="field">
  <label>
    <span>{def.label}</span>
    <input
      type={def.key === 'contact.email' ? 'email' : def.key === 'contact.phone' ? 'tel' : 'text'}
      value={value}
      on:input={handleInput}
    />
  </label>
  {#if candidate}
    <div class="meta">
      <span class={`confidence ${candidate.confidence}`}>{candidate.confidence}</span>
      <span class="source">{candidate.source}</span>
    </div>
  {/if}
  {#if candidates && candidates.length > 1}
    <div class="suggestions">
      <span>Suggestions:</span>
      {#each candidates.slice(1, 4) as suggestion}
        <button type="button" on:click={() => applyCandidate(suggestion)}>{suggestion.value}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid #eef2ff;
    border-radius: 8px;
    background: #f9fafb;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 500;
    color: #111827;
  }
  input {
    width: 100%;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 13px;
    background: #ffffff;
    color: #111827;
  }
  .meta {
    display: flex;
    gap: 8px;
    font-size: 11px;
    color: #6b7280;
  }
  .confidence {
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .confidence.high {
    color: #047857;
  }
  .confidence.medium {
    color: #b45309;
  }
  .confidence.low {
    color: #6b7280;
  }
  .source {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    color: #4b5563;
  }
  .suggestions button {
    border: 1px solid #d1d5db;
    background: #ffffff;
    color: #1f2937;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .suggestions button:hover {
    background: #eff6ff;
    border-color: #bfdbfe;
  }
</style>
