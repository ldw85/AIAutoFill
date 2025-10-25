<script lang="ts">
  import { onMount } from 'svelte';
  import {
    sendRuntimeMessage,
    type SettingsSnapshot,
    type TemplateListResult,
    type TemplateMutationResult,
    type TemplateDeleteResult,
    type UnlockResult,
    type SettingsUpdatePayload,
    type TemplateSavePayload
  } from '../core/messages';
  import type { Mode, TemplateModel } from '../core/model/schemas';
  import { informationFieldKeys } from '../core/model/schemas';

  type TemplateFieldRow = { key: string; value: string };

  const MIN_PASSPHRASE_LENGTH = 8;

  let loading = true;
  let snapshot: SettingsSnapshot | null = null;
  let templates: TemplateModel[] = [];

  let flashMessage = '';
  let flashKind: 'success' | 'error' | '' = '';

  let unlockPassphrase = '';
  let newPassphrase = '';
  let confirmNewPassphrase = '';
  let changeCurrent = '';
  let changeNext = '';
  let changeConfirm = '';

  let templateLabel = '';
  let templateFields: TemplateFieldRow[] = [];
  let editingId: string | null = null;

  let overrideDraft: { pattern: string; mode: Mode } = { pattern: '', mode: 'offline' };
  let semanticEndpointDraft = '';
  let semanticApiKeyDraft = '';
  let unlocked = false;
  let hasPassphrase = false;
  let globalMode: Mode = 'offline';
  let overrides: Array<{ pattern: string; mode: Mode }> = [];
  let apiKeyConfigured = false;

  const keySuggestions = informationFieldKeys;

  onMount(() => {
    initTemplateEditor();
    void fetchSettings();
  });

  $: unlocked = snapshot?.unlocked ?? false;
  $: hasPassphrase = snapshot?.hasPassphrase ?? false;
  $: globalMode = snapshot?.mode ?? 'offline';
  $: overrides = snapshot?.overrides ?? [];
  $: apiKeyConfigured = snapshot?.apiKeyConfigured ?? false;

  function resetFlash(): void {
    flashMessage = '';
    flashKind = '';
  }

  function flashSuccess(message: string): void {
    flashMessage = message;
    flashKind = 'success';
  }

  function flashError(message: string): void {
    flashMessage = message;
    flashKind = 'error';
  }

  function initTemplateEditor(): void {
    editingId = null;
    templateLabel = '';
    templateFields = [{ key: 'identity.full_name', value: '' }];
  }

  function ensureFieldRows(): void {
    if (templateFields.length === 0) {
      templateFields = [{ key: 'identity.full_name', value: '' }];
    }
  }

  async function fetchSettings(): Promise<void> {
    try {
      loading = true;
      resetFlash();
      const response = await sendRuntimeMessage<SettingsSnapshot>({ type: 'SETTINGS_GET' });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to load settings');
      }
      snapshot = response.data;
      semanticEndpointDraft = response.data.semanticEndpoint;
      if (response.data.unlocked) {
        await fetchTemplates();
      } else {
        templates = [];
        initTemplateEditor();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load settings';
      flashError(message);
    } finally {
      loading = false;
    }
  }

  async function fetchTemplates(): Promise<void> {
    const response = await sendRuntimeMessage<TemplateListResult>({ type: 'TEMPLATE_LIST' });
    if (response.success && response.data) {
      templates = response.data.templates ?? [];
    } else if (response.code === 'LOCKED') {
      templates = [];
    } else if (response.error) {
      flashError(response.error);
    }
  }

  function handleFieldChange(index: number, prop: 'key' | 'value', value: string): void {
    templateFields = templateFields.map((row, i) => (i === index ? { ...row, [prop]: value } : row));
  }

  function addFieldRow(): void {
    templateFields = [...templateFields, { key: 'identity.full_name', value: '' }];
  }

  function removeFieldRow(index: number): void {
    templateFields = templateFields.filter((_, i) => i !== index);
    ensureFieldRows();
  }

  function editTemplate(template: TemplateModel): void {
    editingId = template.id;
    templateLabel = template.label;
    const entries = Object.entries(template.values ?? {});
    templateFields = entries.length
      ? entries.map(([key, value]) => ({ key, value: value ?? '' }))
      : [{ key: 'identity.full_name', value: '' }];
  }

  function templatePayload(): TemplateSavePayload | null {
    const label = templateLabel.trim();
    if (!label) {
      flashError('Template name is required.');
      return null;
    }
    const fields = templateFields
      .map((row) => ({ key: row.key.trim(), value: row.value.trim() }))
      .filter((row) => row.key && row.value);
    if (fields.length === 0) {
      flashError('Add at least one template field.');
      return null;
    }
    return {
      id: editingId ?? undefined,
      label,
      fields
    } satisfies TemplateSavePayload;
  }

  async function saveTemplate(): Promise<void> {
    resetFlash();
    const payload = templatePayload();
    if (!payload) return;
    const response = await sendRuntimeMessage<TemplateMutationResult>({ type: 'TEMPLATE_SAVE', payload });
    if (!response.success || !response.data) {
      flashError(response.error || 'Failed to save template.');
      return;
    }
    templates = response.data.templates ?? templates;
    flashSuccess(editingId ? 'Template updated.' : 'Template created.');
    initTemplateEditor();
  }

  async function deleteTemplate(id: string, label: string): Promise<void> {
    if (!window.confirm(`Delete template "${label}"? This cannot be undone.`)) return;
    resetFlash();
    const response = await sendRuntimeMessage<TemplateDeleteResult>({ type: 'TEMPLATE_DELETE', id });
    if (!response.success || !response.data) {
      flashError(response.error || 'Failed to delete template.');
      return;
    }
    templates = response.data.templates ?? templates;
    if (editingId === id) initTemplateEditor();
    flashSuccess('Template deleted.');
  }

  async function handleUnlockExisting(): Promise<void> {
    resetFlash();
    const pass = unlockPassphrase.trim();
    if (!pass) {
      flashError('Enter your passphrase to unlock.');
      return;
    }
    const response = await sendRuntimeMessage<UnlockResult>({ type: 'UNLOCK', passphrase: pass });
    if (!response.success) {
      flashError(response.error || 'Unable to unlock session.');
      return;
    }
    unlockPassphrase = '';
    await fetchSettings();
    flashSuccess('Session unlocked.');
  }

  async function handleSetPassphrase(): Promise<void> {
    resetFlash();
    const pass = newPassphrase.trim();
    if (pass.length < MIN_PASSPHRASE_LENGTH) {
      flashError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`);
      return;
    }
    if (pass !== confirmNewPassphrase.trim()) {
      flashError('Passphrases do not match.');
      return;
    }
    const response = await sendRuntimeMessage<UnlockResult>({ type: 'UNLOCK', passphrase: pass });
    if (!response.success || !response.data) {
      flashError(response.error || 'Failed to set passphrase.');
      return;
    }
    newPassphrase = '';
    confirmNewPassphrase = '';
    await fetchSettings();
    flashSuccess('Passphrase created and session unlocked.');
  }

  async function handleChangePassphrase(): Promise<void> {
    resetFlash();
    if (!changeCurrent.trim()) {
      flashError('Current passphrase is required.');
      return;
    }
    if (changeNext.trim().length < MIN_PASSPHRASE_LENGTH) {
      flashError(`New passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`);
      return;
    }
    if (changeNext.trim() !== changeConfirm.trim()) {
      flashError('New passphrase entries do not match.');
      return;
    }
    const response = await sendRuntimeMessage({
      type: 'PASSPHRASE_CHANGE',
      payload: { current: changeCurrent.trim(), next: changeNext.trim() }
    });
    if (!response.success) {
      flashError(response.error || 'Failed to change passphrase.');
      return;
    }
    changeCurrent = '';
    changeNext = '';
    changeConfirm = '';
    await fetchSettings();
    flashSuccess('Passphrase updated.');
  }

  async function handleLock(): Promise<void> {
    resetFlash();
    const response = await sendRuntimeMessage({ type: 'LOCK' });
    if (!response.success) {
      flashError(response.error || 'Failed to lock session.');
      return;
    }
    await fetchSettings();
    flashSuccess('Session locked.');
  }

  async function updateMode(mode: Mode): Promise<void> {
    if (!snapshot || mode === snapshot.mode) return;
    resetFlash();
    const payload: SettingsUpdatePayload = { mode };
    const response = await sendRuntimeMessage({ type: 'SETTINGS_SET', payload });
    if (!response.success) {
      flashError(response.error || 'Failed to update mode.');
      return;
    }
    await fetchSettings();
    flashSuccess(`Global mode set to ${mode === 'semantic' ? 'Semantic' : 'Offline'}.`);
  }

  async function addOverride(): Promise<void> {
    if (!snapshot) return;
    resetFlash();
    const pattern = overrideDraft.pattern.trim();
    if (!pattern) {
      flashError('Override pattern is required.');
      return;
    }
    const overridesPayload = [...(snapshot.overrides ?? []), { pattern, mode: overrideDraft.mode }];
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { overrides: overridesPayload }
    });
    if (!response.success) {
      flashError(response.error || 'Failed to save override.');
      return;
    }
    overrideDraft = { pattern: '', mode: overrideDraft.mode };
    await fetchSettings();
    flashSuccess('Override saved.');
  }

  async function changeOverrideMode(pattern: string, mode: Mode): Promise<void> {
    if (!snapshot) return;
    resetFlash();
    const overridesPayload = (snapshot.overrides ?? []).map((item) =>
      item.pattern === pattern ? { ...item, mode } : item
    );
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { overrides: overridesPayload }
    });
    if (!response.success) {
      flashError(response.error || 'Failed to update override.');
      return;
    }
    await fetchSettings();
    flashSuccess('Override updated.');
  }

  async function removeOverride(pattern: string): Promise<void> {
    if (!snapshot) return;
    resetFlash();
    const overridesPayload = (snapshot.overrides ?? []).filter((item) => item.pattern !== pattern);
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { overrides: overridesPayload }
    });
    if (!response.success) {
      flashError(response.error || 'Failed to remove override.');
      return;
    }
    await fetchSettings();
    flashSuccess('Override removed.');
  }

  function onOverrideModeSelect(pattern: string, event: Event): void {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    const value = target.value as Mode;
    void changeOverrideMode(pattern, value);
  }

  function onTemplateKeyInput(index: number, event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    handleFieldChange(index, 'key', target.value);
  }

  function onTemplateValueInput(index: number, event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    handleFieldChange(index, 'value', target.value);
  }

  async function saveSemanticEndpoint(): Promise<void> {
    if (!snapshot) return;
    resetFlash();
    const endpoint = semanticEndpointDraft.trim();
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { semantic: { endpoint } }
    });
    if (!response.success) {
      flashError(response.error || 'Failed to update endpoint.');
      return;
    }
    await fetchSettings();
    flashSuccess('Semantic endpoint saved.');
  }

  async function saveSemanticApiKey(): Promise<void> {
    resetFlash();
    if (!semanticApiKeyDraft.trim()) {
      flashError('Enter an API key before saving.');
      return;
    }
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { semantic: { apiKey: semanticApiKeyDraft.trim() } }
    });
    if (!response.success) {
      flashError(response.error || 'Failed to store API key. Unlock the session first.');
      return;
    }
    semanticApiKeyDraft = '';
    await fetchSettings();
    flashSuccess('Semantic API key encrypted and stored.');
  }

  async function clearSemanticApiKey(): Promise<void> {
    resetFlash();
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { semantic: { apiKey: null } }
    });
    if (!response.success) {
      flashError(response.error || 'Failed to clear API key.');
      return;
    }
    await fetchSettings();
    flashSuccess('Semantic API key cleared.');
  }
</script>

<main>
  <header>
    <h1>AIAutoFill Options</h1>
    <p class="muted">Configure security, runtime modes, and your information templates.</p>
  </header>

  {#if loading}
    <p class="muted">Loading settings…</p>
  {:else if !snapshot}
    <p class="error">Unable to load settings. Try reloading the page.</p>
  {:else}
    {#if flashMessage}
      <div class={`flash ${flashKind}`}>{flashMessage}</div>
    {/if}

    <section>
      <h2>Master passphrase</h2>
      <p class="muted">
        Protects templates and secrets with PBKDF2 + AES-GCM encryption. The passphrase is never stored and must be unlocked each browser session.
      </p>

      {#if !hasPassphrase}
        <form class="card" on:submit|preventDefault={handleSetPassphrase}>
          <h3>Create passphrase</h3>
          <label>
            <span>Passphrase</span>
            <input type="password" bind:value={newPassphrase} minlength={MIN_PASSPHRASE_LENGTH} required />
          </label>
          <label>
            <span>Confirm passphrase</span>
            <input type="password" bind:value={confirmNewPassphrase} minlength={MIN_PASSPHRASE_LENGTH} required />
          </label>
          <button type="submit" class="primary">Create &amp; unlock</button>
        </form>
      {:else if !unlocked}
        <form class="card" on:submit|preventDefault={handleUnlockExisting}>
          <h3>Unlock session</h3>
          <label>
            <span>Passphrase</span>
            <input type="password" bind:value={unlockPassphrase} required />
          </label>
          <div class="actions">
            <button type="submit" class="primary">Unlock</button>
          </div>
        </form>
      {:else}
        <div class="card stack">
          <div class="status-row">
            <strong>Session unlocked</strong>
            <button type="button" class="ghost" on:click={handleLock}>Lock now</button>
          </div>
          <form on:submit|preventDefault={handleChangePassphrase} class="change-pass-form">
            <h3>Change passphrase</h3>
            <label>
              <span>Current passphrase</span>
              <input type="password" bind:value={changeCurrent} required />
            </label>
            <div class="row">
              <label>
                <span>New passphrase</span>
                <input type="password" bind:value={changeNext} minlength={MIN_PASSPHRASE_LENGTH} required />
              </label>
              <label>
                <span>Confirm new passphrase</span>
                <input type="password" bind:value={changeConfirm} minlength={MIN_PASSPHRASE_LENGTH} required />
              </label>
            </div>
            <div class="actions">
              <button type="submit" class="ghost">Update passphrase</button>
            </div>
          </form>
        </div>
      {/if}
    </section>

    <section>
      <h2>Global mode</h2>
      <div class="card">
        <label class="radio">
          <input type="radio" name="global-mode" value="offline" checked={globalMode === 'offline'} on:change={() => updateMode('offline')} />
          <span>
            Offline mode
            <small>All processing stays local. Network calls for semantic matching are blocked.</small>
          </span>
        </label>
        <label class="radio">
          <input type="radio" name="global-mode" value="semantic" checked={globalMode === 'semantic'} on:change={() => updateMode('semantic')} />
          <span>
            Semantic mode
            <small>Allows semantic helpers and remote AI calls where permitted.</small>
          </span>
        </label>
      </div>
    </section>

    <section>
      <h2>Site overrides</h2>
      <div class="card">
        {#if overrides.length === 0}
          <p class="muted">No overrides yet.</p>
        {:else}
          <table class="overrides">
            <thead>
              <tr>
                <th>Origin / pattern</th>
                <th>Mode</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each overrides as override (override.pattern)}
                <tr>
                  <td>{override.pattern}</td>
                  <td>
                    <select bind:value={override.mode} on:change={(event) => onOverrideModeSelect(override.pattern, event)}>
                      <option value="offline">Offline</option>
                      <option value="semantic">Semantic</option>
                    </select>
                  </td>
                  <td>
                    <button type="button" class="danger" on:click={() => removeOverride(override.pattern)}>Remove</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        <form class="override-form" on:submit|preventDefault={addOverride}>
          <label>
            <span>Origin pattern</span>
            <input type="text" placeholder="https://example.com" bind:value={overrideDraft.pattern} />
          </label>
          <label>
            <span>Mode</span>
            <select bind:value={overrideDraft.mode}>
              <option value="offline">Offline</option>
              <option value="semantic">Semantic</option>
            </select>
          </label>
          <button type="submit" class="ghost">Add override</button>
        </form>
      </div>
    </section>

    <section>
      <h2>Semantic configuration</h2>
      <div class="card stack">
        <label>
          <span>API endpoint</span>
          <input type="url" placeholder="https://api.example.com/v1" bind:value={semanticEndpointDraft} />
        </label>
        <div class="actions">
          <button type="button" class="ghost" on:click={saveSemanticEndpoint}>Save endpoint</button>
        </div>
        <div class="divider"></div>
        <div class="api-key">
          <label>
            <span>API key</span>
            <input type="password" placeholder={apiKeyConfigured ? 'Stored securely — enter to replace' : 'Enter API key'} bind:value={semanticApiKeyDraft} />
          </label>
          <div class="actions">
            <button type="button" on:click={saveSemanticApiKey} class="ghost">Save key</button>
            <button type="button" on:click={clearSemanticApiKey} class="danger" disabled={!apiKeyConfigured}>Clear stored key</button>
          </div>
          {#if !unlocked}
            <p class="muted">Unlock the session to update encrypted secrets.</p>
          {:else if apiKeyConfigured}
            <p class="muted">A key is currently stored for semantic mode.</p>
          {/if}
        </div>
      </div>
    </section>

    <section>
      <h2>Information templates</h2>
      {#if !unlocked}
        <p class="muted">Unlock the session to create, edit, or delete templates.</p>
      {:else}
        <div class="card template-editor">
          <div class="header">
            <h3>{editingId ? 'Edit template' : 'New template'}</h3>
            <button type="button" class="ghost" on:click={initTemplateEditor}>Start new</button>
          </div>
          <form on:submit|preventDefault={saveTemplate}>
            <label>
              <span>Template name</span>
              <input type="text" placeholder="Personal profile" bind:value={templateLabel} required />
            </label>
            <div class="fields">
              <div class="fields-header">
                <span>Field key</span>
                <span>Value</span>
                <span></span>
              </div>
              {#each templateFields as field, index (index)}
                <div class="field-row">
                  <input
                    type="text"
                    list="template-keys"
                    bind:value={field.key}
                    placeholder="identity.full_name"
                    on:input={(event) => onTemplateKeyInput(index, event)}
                  />
                  <input
                    type="text"
                    bind:value={field.value}
                    placeholder="Jane Doe"
                    on:input={(event) => onTemplateValueInput(index, event)}
                  />
                  <button type="button" class="ghost" on:click={() => removeFieldRow(index)} title="Remove field">Remove</button>
                </div>
              {/each}
              <button type="button" class="ghost" on:click={addFieldRow}>Add field</button>
            </div>
            <div class="actions">
              <button type="submit" class="primary">{editingId ? 'Update template' : 'Save template'}</button>
            </div>
          </form>
        </div>

        <div class="card template-list">
          <h3>Saved templates</h3>
          {#if templates.length === 0}
            <p class="muted">No templates yet. Create one above to get started.</p>
          {:else}
            <ul>
              {#each templates as template (template.id)}
                <li>
                  <div class="template-meta">
                    <strong>{template.label}</strong>
                    <span class="muted">{Object.keys(template.values ?? {}).length} fields</span>
                  </div>
                  <div class="template-actions">
                    <button type="button" on:click={() => editTemplate(template)}>Edit</button>
                    <button type="button" class="danger" on:click={() => deleteTemplate(template.id, template.label)}>Delete</button>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  <datalist id="template-keys">
    {#each keySuggestions as suggestion}
      <option value={suggestion}>{suggestion}</option>
    {/each}
  </datalist>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f5f7fb;
    color: #111827;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Noto Sans", Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  }

  main {
    max-width: 880px;
    margin: 2.5rem auto;
    padding: 0 1.5rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  header h1 {
    margin: 0 0 0.25rem;
    font-size: 2rem;
  }

  .muted {
    color: #6b7280;
    font-size: 0.9rem;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .card {
    background: #fff;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 20px 35px -24px rgba(15, 23, 42, 0.45);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .card.stack {
    gap: 1.5rem;
  }

  .flash {
    border-radius: 10px;
    padding: 0.85rem 1.1rem;
    font-weight: 600;
  }

  .flash.success {
    background: #ecfdf5;
    color: #047857;
  }

  .flash.error {
    background: #fef2f2;
    color: #b91c1c;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-weight: 600;
  }

  input,
  select {
    padding: 0.55rem 0.7rem;
    border-radius: 8px;
    border: 1px solid #d1d5db;
    font-size: 0.95rem;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
  }

  button {
    appearance: none;
    border: none;
    border-radius: 8px;
    padding: 0.55rem 1rem;
    font-size: 0.95rem;
    cursor: pointer;
    font-weight: 600;
  }

  button.primary {
    background: #2563eb;
    color: #fff;
  }

  button.ghost {
    background: #eef2ff;
    color: #3730a3;
  }

  button.danger {
    background: #fee2e2;
    color: #b91c1c;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .radio {
    display: flex;
    gap: 0.8rem;
    align-items: start;
  }

  .radio input[type='radio'] {
    margin-top: 0.3rem;
  }

  .radio span {
    font-weight: 600;
  }

  .radio small {
    display: block;
    font-weight: 400;
    color: #6b7280;
  }

  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .change-pass-form .row {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .override-form {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    align-items: end;
  }

  table.overrides {
    width: 100%;
    border-collapse: collapse;
  }

  table.overrides th,
  table.overrides td {
    text-align: left;
    padding: 0.5rem 0.25rem;
  }

  table.overrides tbody tr:nth-child(odd) {
    background: #f9fafb;
  }

  .api-key {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .divider {
    height: 1px;
    background: #e5e7eb;
  }

  .template-editor .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .fields-header {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 0.75rem;
    font-weight: 600;
    color: #6b7280;
  }

  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 0.75rem;
    align-items: center;
  }

  .template-list ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .template-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 0.75rem 1rem;
  }

  .template-meta {
    display: flex;
    flex-direction: column;
  }

  .template-meta strong {
    font-size: 1rem;
  }

  .template-actions {
    display: flex;
    gap: 0.5rem;
  }

  .error {
    color: #b91c1c;
  }

  @media (max-width: 640px) {
    .fields-header,
    .field-row {
      grid-template-columns: 1fr;
    }

    button.ghost,
    button.primary,
    button.danger {
      width: 100%;
    }
  }
</style>
