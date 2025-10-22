<script lang="ts">
  import { onMount } from 'svelte';
  import {
    loadSettings,
    saveSettings,
    normalizeSettings,
    SETTINGS_STORAGE_KEY,
    type ExtensionSettings,
    type TemplateDefinition
  } from '../lib/settings';
  import { DEFAULT_KEYS } from '../content/ui/keys';

  interface FieldRow {
    key: string;
    value: string;
  }

  const semanticEnvEnabled = (import.meta.env.VITE_SEMANTIC_ENABLED as string) === 'true';
  const semanticEnvConfigured = semanticEnvEnabled && !!(import.meta.env.VITE_EMBEDDINGS_URL as string);

  let loading = true;
  let settings: ExtensionSettings | null = null;
  let status = '';
  let error = '';

  let editingId: string | null = null;
  let formName = '';
  let formFields: FieldRow[] = [{ key: '', value: '' }];

  const keySuggestions = DEFAULT_KEYS;

  onMount(() => {
    void refreshSettings();
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      handleStorageChange(changes, areaName);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  });

  async function refreshSettings(): Promise<void> {
    try {
      settings = await loadSettings();
    } catch (err) {
      console.error(err);
      error = 'Failed to load settings.';
    } finally {
      loading = false;
    }
  }

  function handleStorageChange(
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void {
    if (areaName !== 'local') return;
    if (!Object.prototype.hasOwnProperty.call(changes, SETTINGS_STORAGE_KEY)) return;
    const nextRaw = changes[SETTINGS_STORAGE_KEY]?.newValue as Partial<ExtensionSettings> | null | undefined;
    settings = normalizeSettings(nextRaw || undefined);
  }

  function resetEditor(): void {
    editingId = null;
    formName = '';
    formFields = [{ key: '', value: '' }];
  }

  function ensureFieldCount(): void {
    if (formFields.length === 0) {
      formFields = [{ key: '', value: '' }];
    }
  }

  function editTemplate(id: string): void {
    if (!settings) return;
    const tmpl = settings.templates.find((t) => t.id === id);
    if (!tmpl) return;
    editingId = tmpl.id;
    formName = tmpl.name;
    const entries = Object.entries(tmpl.values || {});
    formFields = entries.length
      ? entries.map(([key, value]) => ({ key, value: value != null ? String(value) : '' }))
      : [{ key: '', value: '' }];
  }

  function addFieldRow(): void {
    formFields = [...formFields, { key: '', value: '' }];
  }

  function updateField(index: number, prop: 'key' | 'value', value: string): void {
    formFields = formFields.map((row, i) => (i === index ? { ...row, [prop]: value } : row));
  }

  function removeField(index: number): void {
    formFields = formFields.filter((_, i) => i !== index);
    ensureFieldCount();
  }

  function generateTemplateId(): string {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch {
      // ignore
    }
    return `tmpl-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }

  function normaliseFields(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const row of formFields) {
      const key = row.key.trim();
      if (!key) continue;
      const value = row.value;
      if (value.trim().length === 0) continue;
      result[key] = value;
    }
    return result;
  }

  async function submitTemplate(): Promise<void> {
    if (!settings) return;
    status = '';
    error = '';
    const trimmedName = formName.trim();
    if (!trimmedName) {
      error = 'Template name is required.';
      return;
    }
    const values = normaliseFields();
    if (Object.keys(values).length === 0) {
      error = 'Add at least one key with a value.';
      return;
    }

    try {
      const now = Date.now();
      const updated = await saveSettings((prev) => {
        const templates = [...prev.templates];
        if (editingId) {
          const idx = templates.findIndex((t) => t.id === editingId);
          if (idx === -1) return prev;
          const existing = templates[idx];
          const nextTemplate: TemplateDefinition = {
            ...existing,
            name: trimmedName,
            values,
            updatedAt: now
          };
          templates[idx] = nextTemplate;
          return { ...prev, templates };
        }

        const newId = generateTemplateId();
        const nextTemplate: TemplateDefinition = {
          id: newId,
          name: trimmedName,
          values,
          createdAt: now,
          updatedAt: now
        };
        templates.push(nextTemplate);
        return {
          ...prev,
          templates,
          quickFillTemplateId: prev.quickFillTemplateId || newId,
          quickExtractTemplateId: prev.quickExtractTemplateId || prev.quickFillTemplateId || newId
        };
      });

      settings = updated;
      status = editingId ? 'Template updated.' : 'Template created.';
      resetEditor();
    } catch (err) {
      console.error(err);
      error = 'Failed to save template.';
    }
  }

  async function deleteTemplate(id: string): Promise<void> {
    if (!settings) return;
    const tmpl = settings.templates.find((t) => t.id === id);
    if (!tmpl) return;
    const confirmed = window.confirm(`Delete template "${tmpl.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const updated = await saveSettings((prev) => {
        const templates = prev.templates.filter((t) => t.id !== id);
        const patch: ExtensionSettings = {
          ...prev,
          templates,
          quickFillTemplateId: prev.quickFillTemplateId === id ? null : prev.quickFillTemplateId,
          quickExtractTemplateId: prev.quickExtractTemplateId === id ? null : prev.quickExtractTemplateId
        };
        return patch;
      });
      settings = updated;
      status = 'Template deleted.';
      if (editingId === id) resetEditor();
    } catch (err) {
      console.error(err);
      error = 'Failed to delete template.';
    }
  }

  async function updateQuickFill(value: string): Promise<void> {
    try {
      const updated = await saveSettings((prev) => ({
        ...prev,
        quickFillTemplateId: value || null
      }));
      settings = updated;
      status = 'Quick fill template updated.';
    } catch (err) {
      console.error(err);
      error = 'Failed to update quick fill template.';
    }
  }

  async function updateQuickExtract(value: string): Promise<void> {
    try {
      const updated = await saveSettings((prev) => ({
        ...prev,
        quickExtractTemplateId: value || null
      }));
      settings = updated;
      status = 'Quick extract template updated.';
    } catch (err) {
      console.error(err);
      error = 'Failed to update quick extract template.';
    }
  }

  async function updateOffline(enabled: boolean): Promise<void> {
    try {
      const updated = await saveSettings((prev) => ({
        ...prev,
        offlineMode: enabled,
        semanticMatching: enabled ? false : prev.semanticMatching
      }));
      settings = updated;
      status = enabled ? 'Offline mode enabled.' : 'Offline mode disabled.';
    } catch (err) {
      console.error(err);
      error = 'Failed to update offline mode.';
    }
  }

  async function updateSemantic(enabled: boolean): Promise<void> {
    if (!semanticEnvConfigured) return;
    try {
      const updated = await saveSettings((prev) => ({
        ...prev,
        semanticMatching: enabled
      }));
      settings = updated;
      status = enabled ? 'Semantic matching enabled.' : 'Semantic matching disabled.';
    } catch (err) {
      console.error(err);
      error = 'Failed to update semantic matching.';
    }
  }

  function onOfflineChange(event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    void updateOffline(target.checked);
  }

  function onSemanticChange(event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    void updateSemantic(target.checked);
  }

  function onQuickFillChange(event: Event): void {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    void updateQuickFill(target.value);
  }

  function onQuickExtractChange(event: Event): void {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    void updateQuickExtract(target.value);
  }

  function onKeyInput(index: number, event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    updateField(index, 'key', target.value);
  }

  function onValueInput(index: number, event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    updateField(index, 'value', target.value);
  }

  function formatTimestamp(ts: number | undefined): string {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return '—';
    }
  }

  $: templates = settings?.templates ?? [];
  $: quickFillSelection = settings?.quickFillTemplateId ?? '';
  $: quickExtractSelection = settings?.quickExtractTemplateId ?? '';
  $: semanticToggleDisabled = !settings || settings.offlineMode || !semanticEnvConfigured;
</script>

<main>
  <h1>AIAutoFill Options</h1>

  {#if loading}
    <p class="muted">Loading settings…</p>
  {:else if !settings}
    <p class="error">Unable to load settings.</p>
  {:else}
    {#if status}
      <div class="status success">{status}</div>
    {/if}
    {#if error}
      <div class="status error">{error}</div>
    {/if}

    <section>
      <h2>Runtime preferences</h2>
      <label class="toggle">
        <input
          type="checkbox"
          checked={settings.offlineMode}
          on:change={onOfflineChange}
        />
        <span>
          Offline mode
          <small>Keep all features local and disable network-dependent lookups.</small>
        </span>
      </label>
      <label class="toggle">
        <input
          type="checkbox"
          checked={settings.semanticMatching}
          disabled={semanticToggleDisabled}
          on:change={onSemanticChange}
        />
        <span>
          Semantic suggestions
          <small>
            {#if !semanticEnvConfigured}
              Build is not configured with an embeddings service.
            {:else if settings.offlineMode}
              Disabled while offline mode is active.
            {:else}
              Uses the configured embeddings endpoint to rerank matches.
            {/if}
          </small>
        </span>
      </label>
    </section>

    <section>
      <h2>Quick actions</h2>
      <div class="row">
        <label for="quick-fill">Quick fill template</label>
        <select
          id="quick-fill"
          value={quickFillSelection}
          on:change={onQuickFillChange}
        >
          <option value="">(Not set)</option>
          {#each templates as tmpl}
            <option value={tmpl.id}>{tmpl.name}</option>
          {/each}
        </select>
      </div>
      <div class="row">
        <label for="quick-extract">Quick extract template</label>
        <select
          id="quick-extract"
          value={quickExtractSelection}
          on:change={onQuickExtractChange}
        >
          <option value="">(Not set)</option>
          {#each templates as tmpl}
            <option value={tmpl.id}>{tmpl.name}</option>
          {/each}
        </select>
      </div>
      <p class="hint">The right-click context menu uses these templates for one-click fill and extraction.</p>
    </section>

    <section>
      <div class="section-header">
        <h2>{editingId ? 'Edit template' : 'Create template'}</h2>
        <button class="link" type="button" on:click={resetEditor}>New template</button>
      </div>
      <form on:submit|preventDefault={submitTemplate} class="template-form">
        <label>
          <span>Template name</span>
          <input type="text" bind:value={formName} placeholder="e.g., Personal profile" />
        </label>
        <div class="fields">
          <div class="fields-header">
            <span>Ontology key</span>
            <span>Value</span>
            <span class="sr-only">Actions</span>
          </div>
          {#each formFields as field, index (index)}
            <div class="field-row">
              <input
                type="text"
                list="aiaf-key-suggestions"
                value={field.key}
                placeholder="e.g., email"
                on:input={(event) => onKeyInput(index, event)}
              />
              <input
                type="text"
                value={field.value}
                placeholder="Value to fill"
                on:input={(event) => onValueInput(index, event)}
              />
              <button type="button" class="ghost" on:click={() => removeField(index)} title="Remove field">✕</button>
            </div>
          {/each}
          <button type="button" class="ghost" on:click={addFieldRow}>Add field</button>
        </div>
        <div class="form-actions">
          <button type="submit" class="primary">{editingId ? 'Update template' : 'Save template'}</button>
        </div>
      </form>
    </section>

    <section>
      <h2>Saved templates</h2>
      {#if templates.length === 0}
        <p class="muted">No templates saved yet.</p>
      {:else}
        <ul class="template-list">
          {#each templates as tmpl (tmpl.id)}
            <li>
              <div>
                <strong>{tmpl.name}</strong>
                <span class="muted">Updated {formatTimestamp(tmpl.updatedAt)}</span>
              </div>
              <div class="actions">
                <button type="button" on:click={() => editTemplate(tmpl.id)}>Edit</button>
                <button type="button" class="danger" on:click={() => deleteTemplate(tmpl.id)}>Delete</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2>Permissions & privacy</h2>
      <ul class="permission-list">
        <li>
          <strong>Context menus</strong> — provides the right-click quick fill and extract actions.
        </li>
        <li>
          <strong>Storage</strong> — saves your templates and preferences locally in the browser.
        </li>
        <li>
          <strong>Semantic matching</strong> (optional) — when enabled, field labels are sent to your configured embeddings
          service to improve matching. No form values are transmitted.
        </li>
      </ul>
      <p class="muted">Review PRIVACY.md for more details on how AIAutoFill handles your data.</p>
    </section>
  {/if}

  <datalist id="aiaf-key-suggestions">
    {#each keySuggestions as suggestion}
      <option value={suggestion.key}>{suggestion.label || suggestion.key}</option>
    {/each}
  </datalist>
</main>

<style>
  main {
    max-width: 760px;
    margin: 2.5rem auto;
    padding: 0 1.5rem 3rem;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell,
      Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
    color: #111827;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
  }

  section {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  }

  h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0 0 1rem;
  }

  .toggle {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    margin-bottom: 0.75rem;
    font-size: 0.95rem;
  }

  .toggle input {
    margin-top: 0.25rem;
  }

  .toggle small {
    display: block;
    font-size: 0.8rem;
    color: #6b7280;
  }

  .row {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 1rem;
    align-items: center;
    margin-bottom: 0.75rem;
    font-size: 0.95rem;
  }

  label {
    font-weight: 500;
  }

  select,
  input[type='text'] {
    width: 100%;
    padding: 0.55rem 0.7rem;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 0.95rem;
    transition: border-color 120ms ease;
  }

  select:focus,
  input[type='text']:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
  }

  .hint {
    font-size: 0.85rem;
    color: #6b7280;
    margin-top: 0.25rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .section-header h2 {
    margin: 0;
  }

  .template-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .template-form label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.95rem;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .fields-header,
  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 0.6rem;
    align-items: center;
  }

  .fields-header {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7280;
  }

  .field-row button {
    justify-self: end;
  }

  .fields > .ghost {
    margin-top: 0.25rem;
    width: fit-content;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
  }

  button {
    font-size: 0.9rem;
    border-radius: 8px;
    padding: 0.5rem 0.9rem;
    border: 1px solid #d1d5db;
    background: #f9fafb;
    color: #111827;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
  }

  button:hover {
    background: #f3f4f6;
  }

  button.primary {
    background: #2563eb;
    border-color: #2563eb;
    color: #ffffff;
  }

  button.primary:hover {
    background: #1d4ed8;
  }

  button.ghost {
    border-color: transparent;
    background: transparent;
    color: #6b7280;
  }

  button.ghost:hover {
    color: #374151;
    background: rgba(148, 163, 184, 0.1);
  }

  button.danger {
    border-color: #dc2626;
    color: #dc2626;
    background: transparent;
  }

  button.danger:hover {
    background: rgba(220, 38, 38, 0.1);
  }

  button.link {
    border: none;
    background: none;
    color: #2563eb;
    padding: 0;
    font-weight: 500;
  }

  button.link:hover {
    text-decoration: underline;
  }

  .status {
    padding: 0.75rem 1rem;
    border-radius: 10px;
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .status.success {
    background: #ecfdf5;
    border: 1px solid #bbf7d0;
    color: #166534;
  }

  .status.error,
  .error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
  }

  .template-list {
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
    padding: 0.75rem 0.5rem;
    border-bottom: 1px solid #f1f5f9;
  }

  .template-list li:last-child {
    border-bottom: none;
  }

  .template-list .actions {
    display: flex;
    gap: 0.5rem;
  }

  .permission-list {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.95rem;
  }

  .muted {
    color: #6b7280;
    font-size: 0.9rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 640px) {
    main {
      padding: 0 1rem 2rem;
    }

    section {
      padding: 1rem;
    }

    .row {
      grid-template-columns: 1fr;
    }

    .fields-header,
    .field-row {
      grid-template-columns: 1fr;
    }

    .field-row button {
      justify-self: start;
    }
  }
</style>
