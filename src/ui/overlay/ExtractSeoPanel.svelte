<script lang="ts">
  import { onMount } from 'svelte';
  import { extractSeoMetadata, type SeoExtractionResult } from '../../content/extract/seo';
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
  import type { Mode, TemplateFieldInput, TemplateModel } from '../../core/model/schemas';

  const FIELD_ORDER = [
    'web.url',
    'web.site_title',
    'web.description',
    'web.keywords',
    'web.canonical_url',
    'web.og_title',
    'web.og_description'
  ] as const;

  const FIELD_LABELS: Record<string, string> = {
    'web.url': 'URL',
    'web.site_title': 'Site title',
    'web.description': 'Description',
    'web.keywords': 'Keywords',
    'web.canonical_url': 'Canonical URL',
    'web.og_title': 'Open Graph title',
    'web.og_description': 'Open Graph description'
  };

  const OPTIONAL_FIELDS = new Set<string>(['web.canonical_url', 'web.og_title', 'web.og_description']);
  const targetTemplateSelectId = 'seo-template-select';
  const templateNameInputId = 'seo-template-name';
  const passphraseInputId = 'seo-template-passphrase';

  let loading = true;
  let saving = false;
  let passphrase = '';
  let templateName = '';
  let selectedTemplateId = '';

  let errorMessage = '';
  let successMessage = '';
  let infoMessage = '';

  let extraction: SeoExtractionResult | null = null;
  let fieldValues: Record<string, string> = {};
  let fieldSources: Record<string, string> = {};
  let keywordsSuggestions: string[] = [];
  let keywordsSource = '';
  let descriptionSource = '';
  let usedSemantic = false;

  let templates: TemplateModel[] = [];
  $: templates = $templatesStore;
  let unlocked = false;
  $: unlocked = $sessionUnlockedStore;

  let mode: Mode = 'offline';
  let semanticEndpoint = '';
  let semanticAvailable = false;
  $: mode = ($effectiveModeStore as Mode) ?? 'offline';
  $: semanticEndpoint = ($semanticEndpointStore || '').trim();
  $: semanticAvailable = mode === 'semantic' && semanticEndpoint.length > 0;

  $: if (selectedTemplateId && !templates.some((t) => t.id === selectedTemplateId)) {
    selectedTemplateId = '';
  }

  onMount(async () => {
    await initialise();
  });

  async function initialise() {
    await runExtraction(false);
    loading = false;
    if (!templateName) {
      const title = document.title?.trim();
      templateName = title ? `${title} SEO` : 'New SEO Snapshot';
    }
  }

  function resetMessages() {
    errorMessage = '';
    successMessage = '';
    infoMessage = '';
  }

  function applyExtraction(result: SeoExtractionResult, semanticRequest: boolean) {
    extraction = result;
    const nextValues: Record<string, string> = {};
    const nextSources: Record<string, string> = {};
    for (const key of FIELD_ORDER) {
      nextValues[key] = result.fields[key]?.value ?? '';
      nextSources[key] = result.fields[key]?.source ?? 'not detected';
    }
    fieldValues = nextValues;
    fieldSources = nextSources;
    keywordsSuggestions = result.suggestedKeywords;
    keywordsSource = result.keywordsSource;
    descriptionSource = result.descriptionSource;
    usedSemantic = result.usedSemantic;
    if (semanticRequest) {
      if (result.usedSemantic) {
        infoMessage = 'Description refined with semantic summary.';
      } else if (!semanticEndpoint) {
        infoMessage = 'Semantic endpoint not configured; kept local summary.';
      } else {
        infoMessage = 'Semantic service unavailable; retained local summary.';
      }
    } else {
      infoMessage = '';
    }
  }

  async function runExtraction(useSemantic: boolean) {
    try {
      resetMessages();
      loading = true;
      const enhancement = useSemantic && semanticAvailable
        ? { active: true, endpoint: semanticEndpoint }
        : { active: false };
      const result = await extractSeoMetadata({
        mode,
        semanticEnhancement: enhancement
      });
      applyExtraction(result, useSemantic);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to extract SEO metadata.';
      console.warn('[AIAutoFill] SEO extraction failed', error);
    } finally {
      loading = false;
    }
  }

  function updateField(key: string, value: string) {
    fieldValues = { ...fieldValues, [key]: value };
  }

  function handleInput(key: string, event: Event) {
    const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement | null;
    if (!target) return;
    updateField(key, target.value);
  }

  function applyKeywordSuggestion(keyword: string) {
    const current = fieldValues['web.keywords'] ?? '';
    const existing = current
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!existing.includes(keyword)) {
      existing.push(keyword);
      fieldValues = { ...fieldValues, 'web.keywords': existing.join(', ') };
    }
  }

  async function handleUnlock() {
    resetMessages();
    const trimmed = passphrase.trim();
    if (!trimmed) {
      errorMessage = 'Enter your master passphrase to unlock templates.';
      return;
    }
    try {
      const response = await sendRuntimeMessage<UnlockResult>({ type: 'UNLOCK', passphrase: trimmed });
      if (!response.success) {
        errorMessage = response.error || 'Unable to unlock session.';
        return;
      }
      passphrase = '';
      sessionUnlockedStore.set(true);
      const list = await sendRuntimeMessage<TemplateListResult>({ type: 'TEMPLATE_LIST' });
      if (list.success && list.data) {
        templatesStore.set(list.data.templates ?? []);
      }
      successMessage = response.data?.status === 'created'
        ? 'Passphrase created and session unlocked.'
        : 'Session unlocked.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to unlock session.';
    }
  }

  function buildTemplateFields(): TemplateFieldInput[] {
    const fields: TemplateFieldInput[] = [];
    for (const key of FIELD_ORDER) {
      const raw = (fieldValues[key] ?? '').trim();
      if (!raw) continue;
      fields.push({ key, value: raw });
    }
    return fields;
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
        fields
      };
      const response = await sendRuntimeMessage<TemplateMutationResult>({ type: 'TEMPLATE_SAVE', payload });
      if (!response.success || !response.data) {
        errorMessage = response.error || 'Failed to save template.';
        return;
      }
      const saved = response.data.template;
      templatesStore.set(response.data.templates ?? []);
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
    }
  }

  async function refineWithSemantic() {
    await runExtraction(true);
  }
</script>

<div class="seo-panel">
  <h2>Extract SEO metadata</h2>

  {#if loading}
    <div class="loading">Scanning page metadata…</div>
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
      <header>Metadata preview</header>
      <div class="meta-summary">
        <div><strong>Description source:</strong> {descriptionSource}</div>
        <div><strong>Keywords source:</strong> {keywordsSource}</div>
        {#if usedSemantic}
          <div class="semantic-flag">Semantic summary applied</div>
        {/if}
      </div>

      {#each FIELD_ORDER as key}
        <div class="field-row">
          <label class="field-label">
            <span class="label-text">
              {FIELD_LABELS[key]}
              {#if OPTIONAL_FIELDS.has(key)}
                <span class="optional">optional</span>
              {/if}
            </span>
            {#if key === 'web.description'}
              <textarea
                rows="4"
                value={fieldValues[key] ?? ''}
                on:input={(event) => handleInput(key, event)}
              ></textarea>
            {:else if key === 'web.keywords'}
              <textarea
                rows="3"
                value={fieldValues[key] ?? ''}
                on:input={(event) => handleInput(key, event)}
              ></textarea>
            {:else}
              <input
                type="text"
                value={fieldValues[key] ?? ''}
                on:input={(event) => handleInput(key, event)}
              />
            {/if}
          </label>
          {#if key === 'web.keywords' && keywordsSuggestions.length}
            <div class="suggestions">
              <span>Suggestions:</span>
              {#each keywordsSuggestions as suggestion}
                <button type="button" on:click={() => applyKeywordSuggestion(suggestion)}>{suggestion}</button>
              {/each}
            </div>
          {/if}
          <div class="source">Source: {fieldSources[key]}</div>
        </div>
      {/each}

      {#if extraction?.fallbackParagraph}
        <details class="fallback">
          <summary>First paragraph preview</summary>
          <p>{extraction.fallbackParagraph}</p>
        </details>
      {/if}

      {#if semanticAvailable}
        <div class="semantic-actions">
          <button type="button" class="ghost" on:click={refineWithSemantic} disabled={loading}>Refine description with semantic summary</button>
          <span class="note">Sends the first paragraph to the configured semantic endpoint.</span>
        </div>
      {/if}
    </section>

    <section>
      <header>Save to template</header>
      <div class="row">
        <label for={targetTemplateSelectId}>Target template</label>
        <select id={targetTemplateSelectId} on:change={onTemplateSelect} value={selectedTemplateId}>
          <option value="">Create new template…</option>
          {#each templates as template}
            <option value={template.id}>{template.label}</option>
          {/each}
        </select>
      </div>
      <div class="row">
        <label for={templateNameInputId}>Template name</label>
        <input id={templateNameInputId} type="text" bind:value={templateName} placeholder="e.g., Example.com SEO" />
      </div>

      {#if !unlocked}
        <div class="row">
          <label for={passphraseInputId}>Master passphrase</label>
          <div class="passphrase-group">
            <input id={passphraseInputId} type="password" bind:value={passphrase} placeholder="Required to unlock encrypted storage" />
            <button type="button" class="ghost" on:click={handleUnlock}>Unlock</button>
          </div>
        </div>
      {/if}

      <div class="actions">
        <button type="button" class="primary" on:click={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save to information template'}
        </button>
      </div>
    </section>
  {/if}
</div>

<style>
  .seo-panel { display: flex; flex-direction: column; gap: 16px; font-size: 13px; color: #1f2937; }
  h2 { margin: 0; font-size: 16px; color: #111827; }
  section { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; background: #ffffff; display: flex; flex-direction: column; gap: 12px; }
  header { font-weight: 600; font-size: 13px; color: #0f172a; }
  .loading { padding: 16px; text-align: center; color: #4b5563; }
  .field-row { display: flex; flex-direction: column; gap: 6px; }
  label { font-weight: 500; color: #111827; display: flex; align-items: center; gap: 6px; }
  .field-label { align-items: flex-start; flex-direction: column; gap: 6px; }
  .label-text { display: flex; align-items: center; gap: 6px; }
  input, textarea, select { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 6px 8px; font-size: 13px; background: #f9fafb; color: #111827; }
  textarea { resize: vertical; }
  select { background: #ffffff; }
  .optional { font-size: 11px; color: #6b7280; background: #f3f4f6; border-radius: 999px; padding: 0 6px; text-transform: uppercase; }
  .source { font-size: 11px; color: #6b7280; }
  .meta-summary { display: grid; gap: 4px; font-size: 12px; color: #334155; }
  .semantic-flag { font-size: 12px; color: #047857; font-weight: 600; }
  .suggestions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: #4b5563; }
  .suggestions button { border: 1px solid #d1d5db; background: #ffffff; color: #1f2937; border-radius: 999px; padding: 2px 8px; font-size: 12px; cursor: pointer; }
  .suggestions button:hover { background: #eef2ff; border-color: #c7d2fe; }
  .semantic-actions { display: flex; flex-direction: column; gap: 4px; }
  .semantic-actions .note { font-size: 11px; color: #6b7280; }
  .ghost { background: transparent; border: 1px solid #d1d5db; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; color: #1d4ed8; align-self: flex-start; }
  .ghost:hover { background: #eff6ff; border-color: #bfdbfe; }
  .ghost:disabled { opacity: 0.6; cursor: default; }
  .row { display: flex; flex-direction: column; gap: 6px; }
  .passphrase-group { display: flex; gap: 6px; }
  .passphrase-group input { flex: 1; }
  .actions { display: flex; justify-content: flex-end; }
  .primary { background: #2563eb; color: #ffffff; border: 1px solid #2563eb; border-radius: 8px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
  .primary:disabled { opacity: 0.6; cursor: default; }
  .message { padding: 8px 10px; border-radius: 8px; font-size: 12px; }
  .message.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .message.success { background: #ecfdf5; color: #047857; border: 1px solid #bbf7d0; }
  .message.info { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
  .fallback { font-size: 12px; color: #374151; }
  .fallback summary { cursor: pointer; }
  .fallback p { margin: 6px 0 0; line-height: 1.4; }
  @media (max-width: 480px) {
    .passphrase-group { flex-direction: column; }
    .ghost { width: 100%; }
  }
</style>
