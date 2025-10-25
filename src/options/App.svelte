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
    type TemplateSavePayload,
    type RehydrateResult
  } from '../core/messages';
  import type { Mode, TemplateModel } from '../core/model/schemas';
  import { informationFieldKeys, keyFormatHint, normalizeKey, isValidTemplateKey } from '../core/model/schemas';
  import { readUiPrefs, updateUiPrefs, DEFAULT_UI_PREFS, type UiPrefs } from '../core/storage/uiPrefs';
  import Toast, { type ToastKind } from '../ui/components/Toast.svelte';

  type TemplateFieldRow = { key: string; value: string };
  type TemplateFieldError = { key?: string; value?: string };
  interface TemplateErrors {
    label?: string;
    fields: TemplateFieldError[];
  }
  interface ToastMessage {
    id: number;
    message: string;
    kind: ToastKind;
    duration: number;
  }

  const MIN_PASSPHRASE_LENGTH = 8;

  let loading = true;
  let snapshot: SettingsSnapshot | null = null;
  let templates: TemplateModel[] = [];

  let unlockPassphrase = '';
  let newPassphrase = '';
  let confirmNewPassphrase = '';
  let changeCurrent = '';
  let changeNext = '';
  let changeConfirm = '';

  let unlockError = '';
  let newPassphraseErrors = { passphrase: '', confirm: '' };
  let changePassErrors = { current: '', next: '', confirm: '' };

  let templateLabel = '';
  let templateFields: TemplateFieldRow[] = [];
  let templateErrors: TemplateErrors = { fields: [] };
  let editingId: string | null = null;

  let templateLabelRef: HTMLInputElement | null = null;
  let templateFieldKeyRefs: Array<HTMLInputElement | null> = [];
  let templateFieldValueRefs: Array<HTMLInputElement | null> = [];
  let unlockInputRef: HTMLInputElement | null = null;
  let newPassphraseRef: HTMLInputElement | null = null;
  let confirmNewPassphraseRef: HTMLInputElement | null = null;
  let changeCurrentRef: HTMLInputElement | null = null;
  let changeNextRef: HTMLInputElement | null = null;
  let changeConfirmRef: HTMLInputElement | null = null;
  let overridePatternRef: HTMLInputElement | null = null;

  let overrideDraft: { pattern: string; mode: Mode } = { pattern: '', mode: 'offline' };
  let overrideError = '';

  let semanticEndpointDraft = '';
  let semanticApiKeyDraft = '';
  let semanticApiKeyError = '';

  let unlocked = false;
  let hasPassphrase = false;
  let globalMode: Mode = 'offline';
  let overrides: Array<{ pattern: string; mode: Mode }> = [];
  let apiKeyConfigured = false;

  let prefsLoaded = false;
  let siteOverridesOpen = !DEFAULT_UI_PREFS.collapseSiteOverrides;
  let sessionDetailsOpen = !DEFAULT_UI_PREFS.collapseSession;

  let toasts: ToastMessage[] = [];
  let toastCounter = 0;

  const keySuggestions = informationFieldKeys;

  onMount(() => {
    initTemplateEditor();
    void initialise();
  });

  async function initialise(): Promise<void> {
    await loadUiPrefs();
    await attemptSessionRehydrate();
    await fetchSettings();
  }

  async function loadUiPrefs(): Promise<void> {
    try {
      const prefs = await readUiPrefs();
      siteOverridesOpen = !prefs.collapseSiteOverrides;
      sessionDetailsOpen = !prefs.collapseSession;
    } catch {
      siteOverridesOpen = !DEFAULT_UI_PREFS.collapseSiteOverrides;
      sessionDetailsOpen = !DEFAULT_UI_PREFS.collapseSession;
    } finally {
      prefsLoaded = true;
    }
  }

  async function persistPrefs(patch: Partial<UiPrefs>): Promise<void> {
    if (!prefsLoaded) return;
    try {
      await updateUiPrefs(patch);
    } catch {
      showToast('error', 'Unable to save view preferences.');
    }
  }

  function setSiteOverridesOpen(open: boolean): void {
    siteOverridesOpen = open;
    void persistPrefs({ collapseSiteOverrides: !open });
  }

  function setSessionDetailsOpen(open: boolean): void {
    sessionDetailsOpen = open;
    void persistPrefs({ collapseSession: !open });
  }

  function handleSessionToggle(event: Event): void {
    const target = event.currentTarget as HTMLDetailsElement | null;
    if (!target) return;
    setSessionDetailsOpen(target.open);
  }

  function handleOverridesToggle(event: Event): void {
    const target = event.currentTarget as HTMLDetailsElement | null;
    if (!target) return;
    setSiteOverridesOpen(target.open);
  }

  async function attemptSessionRehydrate(): Promise<void> {
    try {
      await sendRuntimeMessage<RehydrateResult>({ type: 'ATTEMPT_REHYDRATE' });
    } catch {
      // ignore background errors during rehydrate attempts
    }
  }

  $: unlocked = snapshot?.unlocked ?? false;
  $: hasPassphrase = snapshot?.hasPassphrase ?? false;
  $: globalMode = snapshot?.mode ?? 'offline';
  $: overrides = snapshot?.overrides ?? [];
  $: apiKeyConfigured = snapshot?.apiKeyConfigured ?? false;

  function showToast(kind: ToastKind, message: string, duration = 4500): void {
    toastCounter += 1;
    const toast = { id: toastCounter, message, kind, duration };
    toasts = [...toasts, toast];
  }

  function dismissToast(id: number): void {
    toasts = toasts.filter((toast) => toast.id !== id);
  }

  function focusElement(ref: HTMLInputElement | null): void {
    if (!ref) return;
    ref.focus();
    ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function ensureTemplateErrorSlots(): void {
    templateErrors = {
      label: templateErrors.label,
      fields: templateFields.map((_, index) => templateErrors.fields[index] ?? {})
    };
  }

  function resetTemplateErrors(): void {
    templateErrors = {
      label: undefined,
      fields: templateFields.map(() => ({}))
    };
  }

  function initTemplateEditor(): void {
    editingId = null;
    templateLabel = '';
    templateFields = [{ key: '', value: '' }];
    templateFieldKeyRefs = [];
    templateFieldValueRefs = [];
    resetTemplateErrors();
  }

  function ensureFieldRows(): void {
    if (templateFields.length === 0) {
      templateFields = [{ key: '', value: '' }];
      templateFieldKeyRefs = [];
      templateFieldValueRefs = [];
    }
    ensureTemplateErrorSlots();
  }

  async function fetchSettings(): Promise<void> {
    try {
      loading = true;
      const previousSnapshot = snapshot;
      const previousOverridesCount = overrides.length;
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

      if (previousSnapshot && response.data.unlocked && !previousSnapshot.unlocked) {
        setSessionDetailsOpen(true);
      }
      const nextOverridesCount = response.data.overrides?.length ?? 0;
      if (previousSnapshot && nextOverridesCount > previousOverridesCount) {
        setSiteOverridesOpen(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load settings';
      showToast('error', message);
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
      showToast('error', response.error);
    }
  }

  function handleFieldChange(index: number, prop: 'key' | 'value', value: string): void {
    templateFields = templateFields.map((row, i) => (i === index ? { ...row, [prop]: value } : row));
    ensureTemplateErrorSlots();
    clearTemplateFieldError(index, prop);
  }

  function clearTemplateFieldError(index: number, prop: 'key' | 'value'): void {
    const current = templateErrors.fields[index];
    if (!current || !current[prop]) return;
    const nextFields = templateErrors.fields.slice();
    nextFields[index] = { ...nextFields[index], [prop]: undefined };
    templateErrors = { ...templateErrors, fields: nextFields };
  }

  function addFieldRow(): void {
    templateFields = [...templateFields, { key: '', value: '' }];
    ensureTemplateErrorSlots();
  }

  function removeFieldRow(index: number): void {
    templateFields = templateFields.filter((_, i) => i !== index);
    templateFieldKeyRefs = templateFieldKeyRefs.filter((_, i) => i !== index);
    templateFieldValueRefs = templateFieldValueRefs.filter((_, i) => i !== index);
    ensureFieldRows();
  }

  function editTemplate(template: TemplateModel): void {
    editingId = template.id;
    templateLabel = template.label;
    const entries = Object.entries(template.values ?? {});
    templateFields = entries.length
      ? entries.map(([key, value]) => ({ key, value: value ?? '' }))
      : [{ key: '', value: '' }];
    templateFieldKeyRefs = [];
    templateFieldValueRefs = [];
    ensureFieldRows();
    resetTemplateErrors();
    setSessionDetailsOpen(true);
  }

  function focusFirstTemplateError(): void {
    if (templateErrors.label) {
      focusElement(templateLabelRef);
      return;
    }
    for (let i = 0; i < templateErrors.fields.length; i += 1) {
      const fieldError = templateErrors.fields[i];
      if (!fieldError) continue;
      if (fieldError.key) {
        focusElement(templateFieldKeyRefs[i] ?? null);
        return;
      }
      if (fieldError.value) {
        focusElement(templateFieldValueRefs[i] ?? null);
        return;
      }
    }
  }

  function setTemplateFieldError(index: number, prop: 'key' | 'value', message: string): void {
    const nextFields = templateErrors.fields.slice();
    nextFields[index] = { ...(nextFields[index] ?? {}), [prop]: message };
    templateErrors = { ...templateErrors, fields: nextFields };
  }

  function templatePayload(): TemplateSavePayload | null {
    const sanitizedFields = templateFields.map((row) => ({
      key: normalizeKey(row.key),
      value: row.value
    }));
    templateFields = sanitizedFields;
    resetTemplateErrors();

    const label = templateLabel.trim();
    if (!label) {
      templateErrors = { ...templateErrors, label: 'Template name is required.' };
      focusFirstTemplateError();
      return null;
    }

    let hasError = false;
    const prepared = sanitizedFields.map((row, index) => {
      const key = row.key;
      const value = row.value.trim();

      if (!key) {
        setTemplateFieldError(index, 'key', 'Field key is required.');
        hasError = true;
      } else if (!isValidTemplateKey(key)) {
        setTemplateFieldError(index, 'key', 'Use letters, numbers, dots, underscores, or hyphens.');
        hasError = true;
      }

      if (!value) {
        setTemplateFieldError(index, 'value', 'Value is required.');
        hasError = true;
      }

      return { key, value };
    });

    const filtered = prepared.filter((row) => row.key && row.value);
    if (hasError) {
      focusFirstTemplateError();
      return null;
    }

    if (filtered.length === 0) {
      setTemplateFieldError(0, 'value', 'Add at least one template field.');
      focusFirstTemplateError();
      return null;
    }

    return {
      id: editingId ?? undefined,
      label,
      fields: filtered
    } satisfies TemplateSavePayload;
  }

  async function saveTemplate(): Promise<void> {
    const payload = templatePayload();
    if (!payload) return;

    const response = await sendRuntimeMessage<TemplateMutationResult>({ type: 'TEMPLATE_SAVE', payload });
    if (!response.success || !response.data) {
      showToast('error', response.error || 'Failed to save template.');
      return;
    }
    templates = response.data.templates ?? templates;
    showToast('success', editingId ? 'Template updated.' : 'Template created.');
    initTemplateEditor();
  }

  async function deleteTemplate(id: string, label: string): Promise<void> {
    if (!window.confirm(`Delete template "${label}"? This cannot be undone.`)) return;
    const response = await sendRuntimeMessage<TemplateDeleteResult>({ type: 'TEMPLATE_DELETE', id });
    if (!response.success || !response.data) {
      showToast('error', response.error || 'Failed to delete template.');
      return;
    }
    templates = response.data.templates ?? templates;
    if (editingId === id) initTemplateEditor();
    showToast('success', 'Template deleted.');
  }

  async function handleUnlockExisting(): Promise<void> {
    unlockError = '';
    const pass = unlockPassphrase.trim();
    if (!pass) {
      unlockError = 'Enter your passphrase to unlock.';
      focusElement(unlockInputRef);
      return;
    }
    const response = await sendRuntimeMessage<UnlockResult>({ type: 'UNLOCK', passphrase: pass });
    if (!response.success) {
      unlockError = response.error || 'Unable to unlock session.';
      focusElement(unlockInputRef);
      return;
    }
    unlockPassphrase = '';
    await fetchSettings();
    showToast('success', 'Session unlocked.');
  }

  async function handleSetPassphrase(): Promise<void> {
    newPassphraseErrors = { passphrase: '', confirm: '' };
    const pass = newPassphrase.trim();
    const confirm = confirmNewPassphrase.trim();

    if (pass.length < MIN_PASSPHRASE_LENGTH) {
      newPassphraseErrors = {
        ...newPassphraseErrors,
        passphrase: `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`
      };
      focusElement(newPassphraseRef);
      return;
    }

    if (pass !== confirm) {
      newPassphraseErrors = { ...newPassphraseErrors, confirm: 'Passphrases do not match.' };
      focusElement(confirmNewPassphraseRef);
      return;
    }

    const response = await sendRuntimeMessage<UnlockResult>({ type: 'UNLOCK', passphrase: pass });
    if (!response.success || !response.data) {
      showToast('error', response.error || 'Failed to set passphrase.');
      return;
    }
    newPassphrase = '';
    confirmNewPassphrase = '';
    await fetchSettings();
    showToast('success', 'Passphrase created and session unlocked.');
  }

  async function handleChangePassphrase(): Promise<void> {
    changePassErrors = { current: '', next: '', confirm: '' };

    const current = changeCurrent.trim();
    const next = changeNext.trim();
    const confirm = changeConfirm.trim();

    if (!current) {
      changePassErrors = { ...changePassErrors, current: 'Current passphrase is required.' };
      focusElement(changeCurrentRef);
      return;
    }

    if (next.length < MIN_PASSPHRASE_LENGTH) {
      changePassErrors = {
        ...changePassErrors,
        next: `New passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`
      };
      focusElement(changeNextRef);
      return;
    }

    if (next !== confirm) {
      changePassErrors = { ...changePassErrors, confirm: 'New passphrase entries do not match.' };
      focusElement(changeConfirmRef);
      return;
    }

    const response = await sendRuntimeMessage({
      type: 'PASSPHRASE_CHANGE',
      payload: { current, next }
    });
    if (!response.success) {
      showToast('error', response.error || 'Failed to change passphrase.');
      return;
    }
    changeCurrent = '';
    changeNext = '';
    changeConfirm = '';
    await fetchSettings();
    showToast('success', 'Passphrase updated.');
  }

  async function handleLock(): Promise<void> {
    const response = await sendRuntimeMessage({ type: 'LOCK' });
    if (!response.success) {
      showToast('error', response.error || 'Failed to lock session.');
      return;
    }
    await fetchSettings();
    showToast('success', 'Session locked.');
  }

  async function updateMode(mode: Mode): Promise<void> {
    if (!snapshot || mode === snapshot.mode) return;
    const payload: SettingsUpdatePayload = { mode };
    const response = await sendRuntimeMessage({ type: 'SETTINGS_SET', payload });
    if (!response.success) {
      showToast('error', response.error || 'Failed to update mode.');
      return;
    }
    await fetchSettings();
    showToast('success', `Global mode set to ${mode === 'semantic' ? 'Semantic' : 'Offline'}.`);
  }

  async function addOverride(): Promise<void> {
    if (!snapshot) return;
    overrideError = '';
    const pattern = overrideDraft.pattern.trim();
    if (!pattern) {
      overrideError = 'Origin pattern is required.';
      focusElement(overridePatternRef);
      return;
    }
    const overridesPayload = [...(snapshot.overrides ?? []), { pattern, mode: overrideDraft.mode }];
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { overrides: overridesPayload }
    });
    if (!response.success) {
      showToast('error', response.error || 'Failed to save override.');
      return;
    }
    overrideDraft = { pattern: '', mode: overrideDraft.mode };
    await fetchSettings();
    setSiteOverridesOpen(true);
    showToast('success', 'Override saved.');
  }

  async function changeOverrideMode(pattern: string, mode: Mode): Promise<void> {
    if (!snapshot) return;
    const overridesPayload = (snapshot.overrides ?? []).map((item) =>
      item.pattern === pattern ? { ...item, mode } : item
    );
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { overrides: overridesPayload }
    });
    if (!response.success) {
      showToast('error', response.error || 'Failed to update override.');
      return;
    }
    await fetchSettings();
    showToast('success', 'Override updated.');
  }

  async function removeOverride(pattern: string): Promise<void> {
    if (!snapshot) return;
    const overridesPayload = (snapshot.overrides ?? []).filter((item) => item.pattern !== pattern);
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { overrides: overridesPayload }
    });
    if (!response.success) {
      showToast('error', response.error || 'Failed to remove override.');
      return;
    }
    await fetchSettings();
    showToast('success', 'Override removed.');
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

  function onTemplateKeyBlur(index: number, event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    const normalised = normalizeKey(target.value);
    handleFieldChange(index, 'key', normalised);
    target.value = normalised;
  }

  function onTemplateValueInput(index: number, event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    handleFieldChange(index, 'value', target.value);
  }

  async function saveSemanticEndpoint(): Promise<void> {
    if (!snapshot) return;
    const endpoint = semanticEndpointDraft.trim();
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { semantic: { endpoint } }
    });
    if (!response.success) {
      showToast('error', response.error || 'Failed to update endpoint.');
      return;
    }
    await fetchSettings();
    showToast('success', 'Semantic endpoint saved.');
  }

  async function saveSemanticApiKey(): Promise<void> {
    semanticApiKeyError = '';
    const value = semanticApiKeyDraft.trim();
    if (!value) {
      semanticApiKeyError = 'Enter an API key before saving.';
      return;
    }
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { semantic: { apiKey: value } }
    });
    if (!response.success) {
      showToast('error', response.error || 'Failed to store API key. Unlock the session first.');
      return;
    }
    semanticApiKeyDraft = '';
    await fetchSettings();
    showToast('success', 'Semantic API key encrypted and stored.');
  }

  async function clearSemanticApiKey(): Promise<void> {
    semanticApiKeyError = '';
    const response = await sendRuntimeMessage({
      type: 'SETTINGS_SET',
      payload: { semantic: { apiKey: null } }
    });
    if (!response.success) {
      showToast('error', response.error || 'Failed to clear API key.');
      return;
    }
    await fetchSettings();
    showToast('success', 'Semantic API key cleared.');
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
            <input
              type="password"
              bind:value={newPassphrase}
              minlength={MIN_PASSPHRASE_LENGTH}
              required
              bind:this={newPassphraseRef}
              class:invalid={Boolean(newPassphraseErrors.passphrase)}
              on:input={() => (newPassphraseErrors = { ...newPassphraseErrors, passphrase: '' })}
            />
            {#if newPassphraseErrors.passphrase}
              <p class="error-text">{newPassphraseErrors.passphrase}</p>
            {/if}
          </label>
          <label>
            <span>Confirm passphrase</span>
            <input
              type="password"
              bind:value={confirmNewPassphrase}
              minlength={MIN_PASSPHRASE_LENGTH}
              required
              bind:this={confirmNewPassphraseRef}
              class:invalid={Boolean(newPassphraseErrors.confirm)}
              on:input={() => (newPassphraseErrors = { ...newPassphraseErrors, confirm: '' })}
            />
            {#if newPassphraseErrors.confirm}
              <p class="error-text">{newPassphraseErrors.confirm}</p>
            {/if}
          </label>
          <button type="submit" class="primary">Create &amp; unlock</button>
        </form>
      {:else if !unlocked}
        <form class="card" on:submit|preventDefault={handleUnlockExisting}>
          <h3>Unlock session</h3>
          <label>
            <span>Passphrase</span>
            <input
              type="password"
              bind:value={unlockPassphrase}
              required
              bind:this={unlockInputRef}
              class:invalid={Boolean(unlockError)}
              on:input={() => (unlockError = '')}
            />
            {#if unlockError}
              <p class="error-text">{unlockError}</p>
            {/if}
          </label>
          <div class="actions">
            <button type="submit" class="primary">Unlock</button>
          </div>
        </form>
      {:else}
        <details
          class="card collapsible"
          bind:open={sessionDetailsOpen}
          on:toggle={handleSessionToggle}
        >
          <summary>
            <div class="summary-content">
              <strong>Session unlocked</strong>
              <span class="summary-hint">Unlock lasts for the current browser session and resets on restart.</span>
            </div>
          </summary>
          <div class="session-body">
            <div class="status-row">
              <strong>Session unlocked</strong>
              <button type="button" class="ghost" on:click={handleLock}>Lock now</button>
            </div>
            <form on:submit|preventDefault={handleChangePassphrase} class="change-pass-form">
              <h3>Change passphrase</h3>
              <label>
                <span>Current passphrase</span>
                <input
                  type="password"
                  bind:value={changeCurrent}
                  required
                  bind:this={changeCurrentRef}
                  class:invalid={Boolean(changePassErrors.current)}
                  on:input={() => (changePassErrors = { ...changePassErrors, current: '' })}
                />
                {#if changePassErrors.current}
                  <p class="error-text">{changePassErrors.current}</p>
                {/if}
              </label>
              <div class="row">
                <label>
                  <span>New passphrase</span>
                  <input
                    type="password"
                    bind:value={changeNext}
                    minlength={MIN_PASSPHRASE_LENGTH}
                    required
                    bind:this={changeNextRef}
                    class:invalid={Boolean(changePassErrors.next)}
                    on:input={() => (changePassErrors = { ...changePassErrors, next: '' })}
                  />
                  {#if changePassErrors.next}
                    <p class="error-text">{changePassErrors.next}</p>
                  {/if}
                </label>
                <label>
                  <span>Confirm new passphrase</span>
                  <input
                    type="password"
                    bind:value={changeConfirm}
                    minlength={MIN_PASSPHRASE_LENGTH}
                    required
                    bind:this={changeConfirmRef}
                    class:invalid={Boolean(changePassErrors.confirm)}
                    on:input={() => (changePassErrors = { ...changePassErrors, confirm: '' })}
                  />
                  {#if changePassErrors.confirm}
                    <p class="error-text">{changePassErrors.confirm}</p>
                  {/if}
                </label>
              </div>
              <div class="actions">
                <button type="submit" class="ghost">Update passphrase</button>
              </div>
            </form>
          </div>
        </details>
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
      <details
        class="collapsible"
        bind:open={siteOverridesOpen}
        on:toggle={handleOverridesToggle}
      >
        <summary>
          <div class="summary-content">
            <strong>{overrides.length} {overrides.length === 1 ? 'override' : 'overrides'}</strong>
            <span class="summary-hint">Expand to manage per-site mode preferences.</span>
          </div>
        </summary>
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
              <input
                type="text"
                placeholder="https://example.com"
                bind:value={overrideDraft.pattern}
                bind:this={overridePatternRef}
                class:invalid={Boolean(overrideError)}
                on:input={() => (overrideError = '')}
              />
              {#if overrideError}
                <p class="error-text">{overrideError}</p>
              {/if}
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
      </details>
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
            <input
              type="password"
              placeholder={apiKeyConfigured ? 'Stored securely — enter to replace' : 'Enter API key'}
              bind:value={semanticApiKeyDraft}
              class:invalid={Boolean(semanticApiKeyError)}
              on:input={() => (semanticApiKeyError = '')}
            />
            {#if semanticApiKeyError}
              <p class="error-text">{semanticApiKeyError}</p>
            {/if}
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
              <input
                type="text"
                placeholder="Personal profile"
                bind:value={templateLabel}
                required
                bind:this={templateLabelRef}
                class:invalid={Boolean(templateErrors.label)}
                on:input={() => (templateErrors = { ...templateErrors, label: undefined })}
              />
              {#if templateErrors.label}
                <p class="error-text">{templateErrors.label}</p>
              {/if}
            </label>
            <div class="fields">
              <div class="fields-header">
                <span>Field key</span>
                <span>Value</span>
                <span></span>
              </div>
              <p class="key-hint">{keyFormatHint}</p>
              {#each templateFields as field, index (index)}
                <div class="field-row">
                  <div class="field-input">
                    <input
                      type="text"
                      list="template-keys"
                      bind:value={field.key}
                      placeholder="identity.full_name"
                      bind:this={templateFieldKeyRefs[index]}
                      class:invalid={Boolean(templateErrors.fields[index]?.key)}
                      on:input={(event) => onTemplateKeyInput(index, event)}
                      on:blur={(event) => onTemplateKeyBlur(index, event)}
                    />
                    {#if templateErrors.fields[index]?.key}
                      <p class="error-text">{templateErrors.fields[index]?.key}</p>
                    {/if}
                  </div>
                  <div class="field-input">
                    <input
                      type="text"
                      bind:value={field.value}
                      placeholder="Jane Doe"
                      bind:this={templateFieldValueRefs[index]}
                      class:invalid={Boolean(templateErrors.fields[index]?.value)}
                      on:input={(event) => onTemplateValueInput(index, event)}
                    />
                    {#if templateErrors.fields[index]?.value}
                      <p class="error-text">{templateErrors.fields[index]?.value}</p>
                    {/if}
                  </div>
                  <button type="button" class="ghost" on:click={() => removeFieldRow(index)} title="Remove field">
                    Remove
                  </button>
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

<div class="toast-container" role="region" aria-live="polite" aria-atomic="true" aria-label="Notifications">
  {#each toasts as toast (toast.id)}
    <Toast message={toast.message} kind={toast.kind} duration={toast.duration} on:dismiss={() => dismissToast(toast.id)} />
  {/each}
</div>

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


  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-weight: 600;
  }

  .error-text {
    color: #b91c1c;
    font-size: 0.8rem;
    margin: -0.15rem 0 0;
  }

  .key-hint {
    font-size: 0.8rem;
    color: #6b7280;
    margin: -0.25rem 0 0;
  }

  .field-input {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  input.invalid {
    border-color: #dc2626;
    box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.2);
  }

  input.invalid:focus {
    border-color: #dc2626;
    box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.3);
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

  details.collapsible {
    display: block;
    border: none;
  }

  details.collapsible summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    list-style: none;
    gap: 0.5rem;
    font-weight: 600;
    padding: 0.5rem 0;
  }

  details.collapsible summary::-webkit-details-marker {
    display: none;
  }

  details.collapsible summary:focus-visible {
    outline: 2px solid rgba(37, 99, 235, 0.6);
    border-radius: 8px;
  }

  .summary-content {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .summary-hint {
    font-size: 0.85rem;
    color: #6b7280;
    font-weight: 400;
  }

  details.card.collapsible {
    padding: 0;
  }

  details.card.collapsible summary {
    padding: 1.5rem 1.5rem 1.25rem;
  }

  details.card.collapsible[open] summary {
    border-bottom: 1px solid #e5e7eb;
  }

  .session-body {
    padding: 0 1.5rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
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
    align-items: flex-start;
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

  .toast-container {
    position: fixed;
    right: 1.5rem;
    bottom: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    z-index: 1000;
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

    .toast-container {
      right: 1rem;
      left: 1rem;
      bottom: 1rem;
    }
  }
</style>
