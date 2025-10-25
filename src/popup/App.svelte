<script lang="ts">
  import { onMount } from 'svelte';
  import { sendRuntimeMessage, type SettingsSnapshot } from '../core/messages';
  import type { Mode } from '../core/model/schemas';

  let loading = true;
  let snapshot: SettingsSnapshot | null = null;
  let origin = '';
  let error = '';
  let toggling = false;

  onMount(() => {
    void initialise();
  });

  function getActiveOrigin(): Promise<string> {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (tab?.url) {
          try {
            const url = new URL(tab.url);
            resolve(url.origin);
            return;
          } catch {
            // ignore malformed URL
          }
        }
        resolve('');
      });
    });
  }

  async function initialise(): Promise<void> {
    loading = true;
    error = '';
    try {
      origin = await getActiveOrigin();
      const response = await sendRuntimeMessage<SettingsSnapshot>({
        type: 'SETTINGS_GET',
        origin: origin || undefined
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to load status.');
      }
      snapshot = response.data;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load status.';
      snapshot = null;
    } finally {
      loading = false;
    }
  }

  $: effectiveMode = snapshot?.effectiveMode ?? snapshot?.mode ?? 'offline';
  $: unlocked = snapshot?.unlocked ?? false;

  async function toggleMode(): Promise<void> {
    if (!snapshot || toggling) return;
    toggling = true;
    error = '';
    const nextMode: Mode = snapshot.mode === 'semantic' ? 'offline' : 'semantic';
    const response = await sendRuntimeMessage({ type: 'SETTINGS_SET', payload: { mode: nextMode } });
    if (!response.success) {
      error = response.error || 'Failed to update mode.';
    }
    await initialise();
    toggling = false;
  }

  async function lockSession(): Promise<void> {
    await sendRuntimeMessage({ type: 'LOCK' });
    await initialise();
  }

  function openOptions(): void {
    if (typeof chrome.runtime.openOptionsPage === 'function') {
      chrome.runtime.openOptionsPage();
    } else {
      const url = chrome.runtime.getURL('src/options/index.html');
      void chrome.tabs.create({ url });
    }
  }
</script>

<main>
  <h1>AIAutoFill</h1>
  {#if loading}
    <p class="muted">Checking status…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if snapshot}
    <div class="card">
      <div class="status">
        <span class={`dot ${unlocked ? 'unlocked' : 'locked'}`}></span>
        <div>
          <strong>{unlocked ? 'Unlocked' : 'Locked'}</strong>
          <small>{unlocked ? 'Templates available for filling.' : 'Unlock from options to access templates.'}</small>
        </div>
      </div>
      <div class="details">
        <div>
          <span class="label">Global mode</span>
          <strong>{snapshot.mode === 'semantic' ? 'Semantic' : 'Offline'}</strong>
        </div>
        <div>
          <span class="label">This site</span>
          <strong>{effectiveMode === 'semantic' ? 'Semantic allowed' : 'Offline only'}</strong>
          {#if origin}
            <small class="muted">{origin}</small>
          {/if}
        </div>
      </div>
      <div class="actions">
        <button type="button" class="ghost" on:click={toggleMode} disabled={toggling}>
          Switch to {snapshot.mode === 'semantic' ? 'Offline' : 'Semantic'}
        </button>
        <button type="button" class="primary" on:click={openOptions}>Open Options</button>
      </div>
      <div class="footer">
        <button type="button" class="link" on:click={lockSession} disabled={!unlocked}>Lock session</button>
      </div>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    min-width: 320px;
    background: #0f172a;
    color: #fff;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Noto Sans", Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  }

  main {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
  }

  .muted {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.95rem;
  }

  .error {
    color: #fca5a5;
  }

  .card {
    background: #111c3a;
    border-radius: 14px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: 0 24px 60px -34px rgba(15, 23, 42, 0.9);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fca5a5;
    box-shadow: 0 0 0 4px rgba(252, 165, 165, 0.3);
  }

  .dot.unlocked {
    background: #34d399;
    box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.3);
  }

  .status strong {
    display: block;
    font-size: 1.1rem;
  }

  .status small {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.85rem;
  }

  .details {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  }

  .label {
    display: block;
    text-transform: uppercase;
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 0.25rem;
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  button {
    appearance: none;
    border: none;
    border-radius: 999px;
    padding: 0.55rem 1.1rem;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
  }

  button.primary {
    background: #2563eb;
    color: #fff;
  }

  button.ghost {
    background: rgba(148, 163, 184, 0.2);
    color: #e0e7ff;
  }

  button.link {
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.85rem;
    padding: 0;
    text-decoration: underline;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
  }
</style>
