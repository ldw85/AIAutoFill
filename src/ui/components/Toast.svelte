<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';

  export type ToastKind = 'success' | 'error' | 'info';

  export let message: string;
  export let kind: ToastKind = 'info';
  export let duration = 4500;
  export let dismissible = true;

  const dispatch = createEventDispatcher<{ dismiss: void }>();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    if (duration > 0) {
      timeoutId = setTimeout(() => {
        dispatch('dismiss');
      }, duration);
    }
  });

  onDestroy(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });

  function close(): void {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    dispatch('dismiss');
  }

  const ariaRole = kind === 'error' ? 'alert' : 'status';
  const ariaLive = kind === 'error' ? 'assertive' : 'polite';
</script>

<div class={`toast ${kind}`} role={ariaRole} aria-live={ariaLive} aria-atomic="true">
  <span class="message">{message}</span>
  {#if dismissible}
    <button type="button" class="close" on:click={close} aria-label="Dismiss notification">×</button>
  {/if}
</div>

<style>
  .toast {
    min-width: 240px;
    max-width: 320px;
    background: #1f2937;
    color: #f9fafb;
    border-radius: 12px;
    padding: 0.85rem 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    box-shadow: 0 20px 40px -24px rgba(15, 23, 42, 0.65);
    font-size: 0.9rem;
  }

  .toast.success {
    background: #0f766e;
  }

  .toast.error {
    background: #b91c1c;
  }

  .toast.info {
    background: #1f2937;
  }

  .message {
    flex: 1;
    line-height: 1.4;
  }

  .close {
    appearance: none;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 1.25rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close:focus {
    outline: 2px solid rgba(255, 255, 255, 0.6);
    outline-offset: 2px;
  }
</style>
