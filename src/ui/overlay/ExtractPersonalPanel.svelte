<script lang="ts">
  import { onMount } from 'svelte';
  import {
    extractPersonalInformation,
    PERSONAL_FIELD_DEFINITIONS,
    type PersonalExtractionResult,
    type PersonalFieldKey,
    type PersonalFieldCandidate
  } from '../../content/extract/personal';
  import PersonalFieldEditor from './PersonalFieldEditor.svelte';
  import {
    templatesStore,
    sessionUnlocked as sessionUnlockedStore,
    effectiveMode as effectiveModeStore,
    semanticEndpoint as semanticEndpointStore
  } from '../../content/ui/state';
  import {
    sendRuntimeMessage,
    type TemplateMutationResult,
    type TemplateListResult,
    type UnlockResult
  } from '../../core/messages';
  import type { Mode, TemplateFieldInput, TemplateModel, ConflictStrategy } from '../../core/model/schemas';

  type FieldValues = Record<PersonalFieldKey, string>;
  type FieldCandidates = Record<PersonalFieldKey, PersonalFieldCandidate[]>;

  const INITIAL_VALUES: FieldValues = PERSONAL_FIELD_DEFINITIONS.reduce((acc, def) => {
    acc[def.key] = '';
    return acc;
  }, {} as FieldValues);

  let loading = true;
  let saving = false;
  let runningSemantic = false;

  let fieldValues: FieldValues = { ...INITIAL_VALUES };
  let fieldCandidates: FieldCandidates = PERSONAL_FIELD_DEFINITIONS.reduce((acc, def) => {
    acc[def.key] = [];
    return acc;
  }, {} as FieldCandidates);

  let errorMessage = '';
  let successMessage = '';
  let infoMessage = '';
  let usedSemantic = false;

  let templates: TemplateModel[] = [];
  $: templates = $templatesStore;
  let unlocked = false;
  $: unlocked = $sessionUnlockedStore;
  let mode: Mode = 'offline';
  $: mode = ($effectiveModeStore as Mode) ?? 'offline';
  let semanticEndpoint = '';
  $: semanticEndpoint = $semanticEndpointStore || '';
  let semanticAvailable = false;
  $: semanticAvailable = mode === 'semantic' && semanticEndpoint.trim().length > 0;

  let selectedTemplateId = '';
  $: {
    if (selectedTemplateId && !templates.some((t) => t.id === selectedTemplateId)) {
      selectedTemplateId = '';
    }
  }
  let templateName = '';
  let conflictStrategy: ConflictStrategy = 'merge';

  let passphrase = '';

  onMount(async () => {
    await runExtraction(false);
    loading = false;
  });

  function resetMessages() {
    errorMessage = '';
    successMessage = '';
    infoMessage = '';
  }

  function applyExtraction(data: PersonalExtractionResult, semanticRun: boolean) {
    usedSemantic = data.usedSemantic;
    const nextValues: FieldValues = { ...INITIAL_VALUES };
    for (const def of PERSONAL_FIELD_DEFINITIONS) {
      nextValues[def.key] = data.fields[def.key]?.value ?? '';
    }
    fieldValues = nextValues;
    fieldCandidates = PERSONAL_FIELD_DEFINITIONS.reduce((acc, def) => {
      const list = data.candidates[def.key] ?? [];
      acc[def.key] = list;
      return acc;
    }, {} as FieldCandidates);
    if (!templateName) {
      const name = data.fields['identity.full_name']?.value;
      templateName = name ? `${name} Personal` : `${document.title?.trim() || 'Personal'} Info`;
    }
    if (semanticRun) {
      if (usedSemantic) {
        infoMessage = 'Semantic NER applied to enhance detected entities.';
      } else if (!semanticEndpoint) {
        infoMessage = 'Semantic endpoint not configured; kept local heuristics.';
      } else {
        infoMessage = 'Semantic service unavailable; showing heuristic results.';
      }
    } else {
      infoMessage = '';
    }
  }

  async function runExtraction(useSemantic: boolean) {
    try {
      resetMessages();
      if (useSemantic) {
        runningSemantic = true;
      } else {
        loading = true;
      }
      const semanticConfig = useSemantic && semanticAvailable
        ? { endpoint: semanticEndpoint.trim(), active: true }
        : undefined;
      const extraction = await extractPersonalInformation({
        mode,
        semantic: semanticConfig
      });
      applyExtraction(extraction, Boolean(semanticConfig));
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to extract personal information.';
      console.warn('[AIAutoFill] personal extraction failed', error);
    } finally {
      loading = false;
      runningSemantic = false;
    }
  }

  async function refreshTemplates() {
    const response = await sendRuntimeMessage<TemplateListResult>({ type: 'TEMPLATE_LIST' });
    if (response.success && response.data) {
      templatesStore.set(response.data.templates ?? []);
    }
  }

  function updateField(key: PersonalFieldKey, value: string) {
    fieldValues = { ...fieldValues, [key]: value };
  }

  function applySuggestion(key: PersonalFieldKey, candidate: PersonalFieldCandidate) {
    updateField(key, candidate.value);
  }

  function bestCandidateFor(key: PersonalFieldKey): PersonalFieldCandidate | undefined {
    const list = fieldCandidates[key] || [];
    return list.length ? list[0] : undefined;
  }

  function buildTemplateFields(): TemplateFieldInput[] {
    const fields: TemplateFieldInput[] = [];
    for (const def of PERSONAL_FIELD_DEFINITIONS) {
      const value = fieldValues[def.key]?.trim();
      if (!value) continue;
      fields.push({ key: def.key, value });
    }
    return fields;
  }

  async function handleUnlock() {
    resetMessages();
    const trimmed = passphrase.trim();
    if (!trimmed) {
      errorMessage = 'Enter your master passphrase to unlock templates.';
      return;
    }
    const response = await sendRuntimeMessage<UnlockResult>({ type: 'UNLOCK', passphrase: trimmed });
    if (!response.success) {
      errorMessage = response.error || 'Unable to unlock session.';
      return;
    }
    passphrase = '';
    sessionUnlockedStore.set(true);
    await refreshTemplates();
    successMessage = response.data?.status === 'created'
      ? 'Passphrase created and session unlocked.'
      : 'Session unlocked.';
  }

  async function handleSave() {
    resetMessages();
    if (!unlocked) {
      errorMessage = 'Unlock templates before saving.';
      return;
    }
    const name = templateName.trim();
    if (!name) {
      errorMessage = 'Template name is required.';
      return;
    }
    const fields = buildTemplateFields();
    if (!fields.length) {
      errorMessage = 'Populate at least one field before saving.';
      return;
    }
    saving = true;
    try {
      const payload = {
        id: selectedTemplateId || undefined,
        label: name,
        fields,
        conflictStrategy
      };
      const response = await sendRuntimeMessage<TemplateMutationResult>({ type: 'TEMPLATE_SAVE', payload });
      if (!response.success || !response.data) {
        errorMessage = response.error || 'Failed to save template.';
        return;
      }
      templatesStore.set(response.data.templates ?? []);
      const saved = response.data.template;
      selectedTemplateId = saved.id;
      templateName = saved.label;
      successMessage = `Template "${saved.label}" saved.`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to save template.';
    } finally {
      saving = false;
    }
  }

  function onTemplateSelect(event: Event) {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    selectedTemplateId = target.value || '';
    if (selectedTemplateId) {
      const match = templates.find((item) => item.id === selectedTemplateId);
      if (match) {
        templateName = match.label;
      }
      conflictStrategy = 'merge';
    } else {
      conflictStrategy = 'replace';
    }
  }

  const identityFields = PERSONAL_FIELD_DEFINITIONS.filter((def) => def.key.startsWith('identity.'));
  const contactFields = PERSONAL_FIELD_DEFINITIONS.filter((def) => def.key.startsWith('contact.'));
  const organizationFields = PERSONAL_FIELD_DEFINITIONS.filter((def) => def.key.startsWith('organization.'));
  const addressFields = PERSONAL_FIELD_DEFINITIONS.filter((def) => def.key.startsWith('address.'));
</script>

<div class="personal-panel">
  <h2>Extract personal information</h2>

  {#if loading}
    <div class="loading">Scanning page for personal details…</div>
  {:else}
    {#if errorMessage}
      <div class="message error">{errorMessage}</div>
    {/if}
    {#if successMessage}
      <div class="message success">{successMessage}</div>
    {/if}
    {#if infoMessage}
      <div class="message info">{infoMessage}</div>
    {/if}

    <section>
      <header>Detected values</header>
      <div class="actions">
        <button type="button" class="ghost" on:click={() => runExtraction(false)} disabled={loading || runningSemantic}>Refresh</button>
        {#if semanticAvailable}
          <button
            type="button"
            class="ghost"
            on:click={() => runExtraction(true)}
            disabled={runningSemantic}
          >
            {runningSemantic ? 'Running semantic NER…' : 'Refine with semantic NER'}
          </button>
        {/if}
      </div>
      <div class="section-grid">
        <div>
          <h3>Identity</h3>
          <div class="field-list">
            {#each identityFields as field}
              <PersonalFieldEditor
                def={field}
                value={fieldValues[field.key]}
                candidate={bestCandidateFor(field.key)}
                candidates={fieldCandidates[field.key]}
                on:change={(event) => updateField(field.key, event.detail)}
                on:suggestion={(event) => applySuggestion(field.key, event.detail)}
              />
            {/each}
          </div>
        </div>
        <div>
          <h3>Contact</h3>
          <div class="field-list">
            {#each contactFields as field}
              <PersonalFieldEditor
                def={field}
                value={fieldValues[field.key]}
                candidate={bestCandidateFor(field.key)}
                candidates={fieldCandidates[field.key]}
                on:change={(event) => updateField(field.key, event.detail)}
                on:suggestion={(event) => applySuggestion(field.key, event.detail)}
              />
            {/each}
          </div>
        </div>
      </div>
      <div class="section-grid">
        <div>
          <h3>Organization</h3>
          <div class="field-list">
            {#each organizationFields as field}
              <PersonalFieldEditor
                def={field}
                value={fieldValues[field.key]}
                candidate={bestCandidateFor(field.key)}
                candidates={fieldCandidates[field.key]}
                on:change={(event) => updateField(field.key, event.detail)}
                on:suggestion={(event) => applySuggestion(field.key, event.detail)}
              />
            {/each}
          </div>
        </div>
        <div>
          <h3>Address</h3>
          <div class="field-list">
            {#each addressFields as field}
              <PersonalFieldEditor
                def={field}
                value={fieldValues[field.key]}
                candidate={bestCandidateFor(field.key)}
                candidates={fieldCandidates[field.key]}
                on:change={(event) => updateField(field.key, event.detail)}
                on:suggestion={(event) => applySuggestion(field.key, event.detail)}
              />
            {/each}
          </div>
        </div>
      </div>
    </section>

    <section>
      <header>Save to template</header>
      <div class="row">
        <label for="personal-template-select">Target template</label>
        <select id="personal-template-select" on:change={onTemplateSelect} bind:value={selectedTemplateId}>
          <option value="">Create new template…</option>
          {#each templates as template}
            <option value={template.id}>{template.label}</option>
          {/each}
        </select>
      </div>
      <div class="row">
        <label for="personal-template-name">Template name</label>
        <input id="personal-template-name" type="text" bind:value={templateName} placeholder="e.g., Ada Lovelace Personal" />
      </div>
      {#if !unlocked}
        <div class="row">
          <label for="personal-passphrase">Master passphrase</label>
          <div class="passphrase-group">
            <input
              id="personal-passphrase"
              type="password"
              bind:value={passphrase}
              placeholder="Required to unlock encrypted storage"
            />
            <button type="button" class="ghost" on:click={handleUnlock}>Unlock</button>
          </div>
        </div>
      {/if}
      <fieldset class="conflict">
        <legend>When template already has values</legend>
        <label>
          <input type="radio" name="conflict" value="merge" bind:group={conflictStrategy} />
          Merge — keep existing values and add new ones for empty fields; combine differences.
        </label>
        <label>
          <input type="radio" name="conflict" value="replace" bind:group={conflictStrategy} />
          Replace — overwrite with extracted values.
        </label>
        <label>
          <input type="radio" name="conflict" value="keep" bind:group={conflictStrategy} />
          Keep existing — only add values for fields that are currently empty.
        </label>
      </fieldset>
      <div class="actions">
        <button type="button" class="primary" on:click={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save to information template'}
        </button>
      </div>
    </section>
  {/if}
</div>


<style>
  .personal-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    font-size: 13px;
    color: #1f2937;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    color: #111827;
  }
  section {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 12px;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    font-weight: 600;
    font-size: 13px;
    color: #0f172a;
  }
  .loading {
    padding: 16px;
    text-align: center;
    color: #4b5563;
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }
  .section-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }
  .field-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  input, select {
    width: 100%;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 13px;
    background: #ffffff;
    color: #111827;
  }
  .ghost {
    background: transparent;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    color: #1d4ed8;
  }
  .ghost:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .passphrase-group {
    display: flex;
    gap: 6px;
  }
  .passphrase-group input {
    flex: 1;
  }
  .conflict {
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .conflict legend {
    font-weight: 600;
    font-size: 12px;
    padding: 0 6px;
    color: #0f172a;
  }
  .conflict label {
    display: flex;
    gap: 6px;
    font-size: 12px;
    color: #374151;
    align-items: flex-start;
  }
  .message {
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
  }
  .message.error {
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecaca;
  }
  .message.success {
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #bbf7d0;
  }
  .message.info {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }
  .primary {
    background: #2563eb;
    color: #ffffff;
    border: 1px solid #2563eb;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  @media (max-width: 520px) {
    .section-grid {
      grid-template-columns: 1fr;
    }
    .passphrase-group {
      flex-direction: column;
    }
    .actions {
      justify-content: flex-start;
    }
  }
</style>
