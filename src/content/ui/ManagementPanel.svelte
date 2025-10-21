<script lang="ts">
  import { onMount } from 'svelte';
  import { batch, candidatesView, keys, panelOpen, scan, readCandidateValue, applyAll, undoAll, applyCandidate, undoCandidate } from './state';
  import type { CandidateView } from './state';
  import type { BatchMatchResult, MatchResult } from '../../lib/fieldMatcher';
  import { listTemplates, saveTemplate, saveMappingPreferences, loadMappingPreferences, extractValuesFromPage } from '../templates';

  let tab: 'preview' | 'templates' = 'preview';
  let passphrase = '';
  let templateName = '';
  let saving = false;
  let message = '';
  let templateList: Array<{ name: string; versions: number[] }> = [];

  // mapping selection per candidate id -> ontology key
  let selection: Record<string, string> = {};

  function origin(): string { return location.origin; }

  function resetSelection() {
    selection = {};
    const cvs: CandidateView[] = $candidatesView;
    for (const cv of cvs) {
      if (!cv.best) continue;
      selection[cv.candidate.id] = cv.best.key.key;
    }
  }

  function initFromPrefs(map: Map<string, string>) {
    const cvs: CandidateView[] = $candidatesView;
    for (const cv of cvs) {
      const label = (cv.candidate.accessibleName?.value || '').toString();
      const norm = label.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      const pref = map.get(norm);
      if (pref) selection[cv.candidate.id] = pref;
    }
  }

  function bestForKey(b: BatchMatchResult | null, key: string): MatchResult | undefined {
    if (!b) return undefined;
    const arr = b.byKey[key] || [];
    return arr[0];
  }

  async function refreshTemplates() {
    if (!passphrase) { templateList = []; return; }
    templateList = await listTemplates(passphrase);
  }

  async function loadPrefs() {
    if (!passphrase) { message = 'Enter passphrase to load preferences'; return; }
    const m = await loadMappingPreferences(passphrase, origin());
    resetSelection();
    initFromPrefs(m);
    message = 'Mapping preferences loaded for this site (if any)';
  }

  async function savePrefs() {
    if (!passphrase) { message = 'Enter passphrase to save preferences'; return; }
    const s = $scan;
    if (!s) { message = 'No scan available'; return; }
    const items = s.candidates.map((c) => ({ label: (c.accessibleName?.value || '').toString(), key: selection[c.id] || '' })).filter((x) => !!x.key);
    await saveMappingPreferences(passphrase, origin(), items);
    message = 'Mapping preferences saved';
  }

  async function extractAndSave() {
    if (!passphrase) { message = 'Enter passphrase to save templates'; return; }
    if (!templateName.trim()) { message = 'Enter a template name'; return; }
    const s = $scan; if (!s) { message = 'No scan available'; return; }
    saving = true; message = '';
    try {
      const data = extractValuesFromPage(selection, s.candidates, readCandidateValue);
      const v = await saveTemplate(passphrase, templateName.trim(), data);
      message = `Saved template "${templateName.trim()}" v${v}`;
      await refreshTemplates();
    } catch (e) {
      message = 'Failed to save template';
      console.warn(e);
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    resetSelection();
  });
</script>

<div class="aiaf-panel" role="dialog" aria-label="AIAutoFill Panel">
  <header>
    <strong>AIAutoFill</strong>
    <div class="tabs">
      <button class:active={tab==='preview'} on:click={() => tab='preview'}>Preview</button>
      <button class:active={tab==='templates'} on:click={() => tab='templates'}>Templates</button>
    </div>
    <button on:click={() => panelOpen.set(false)}>×</button>
  </header>

  {#if tab === 'preview'}
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
                <button class="primary" on:click={() => { const m = bestForKey($batch, kc.key.key); if (m) { const list = $keys; const kc2 = list.find((k) => k.key.key === m.key.key); if (kc2?.value != null) applyCandidate(m.candidate, m, kc2.value); } }}>Apply</button>
                <button on:click={() => { const m = bestForKey($batch, kc.key.key); if (m) undoCandidate(m.candidate); }}>Undo</button>
              </div>
            </div>
          {/key}
        {/if}
      {/each}
      <footer>
        <button on:click={() => applyAll()}>Apply All</button>
        <button on:click={() => undoAll()}>Undo All</button>
      </footer>
    </div>
  {:else}
    <div class="body">
      <div class="section">
        <div class="row">
          <label for="aiaf-pass">Master passphrase</label>
          <input id="aiaf-pass" type="password" bind:value={passphrase} placeholder="Required for encrypted storage" on:change={refreshTemplates} />
          <div class="actions">
            <button on:click={loadPrefs}>Load Prefs</button>
            <button on:click={savePrefs}>Save Prefs</button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="subheader">Mapping (field → ontology key)</div>
        {#each $candidatesView as cv}
          {#key cv.candidate.id}
            <div class="map-row">
              <div class="field-label">{cv.candidate.accessibleName?.value || cv.candidate.attributes?.placeholder || cv.candidate.attributes?.name || cv.candidate.tagName}</div>
              <div class="arrow">→</div>
              <div>
                <select bind:value={selection[cv.candidate.id]}>
                  <option value="">(ignore)</option>
                  {#each $keys as kc}
                    <option value={kc.key.key}>{kc.key.label || kc.key.key}</option>
                  {/each}
                </select>
              </div>
            </div>
          {/key}
        {/each}
        <div class="row right">
          <button on:click={resetSelection}>Reset</button>
        </div>
      </div>

      <div class="section">
        <div class="subheader">Extract to Information Template</div>
        <div class="row">
          <label for="aiaf-template-name">Template name</label>
          <input id="aiaf-template-name" type="text" bind:value={templateName} placeholder="e.g., Personal Basic" />
          <button class="primary" disabled={saving} on:click={extractAndSave}>Extract & Save</button>
        </div>
        {#if message}
          <div class="message">{message}</div>
        {/if}
      </div>

      <div class="section">
        <div class="subheader">Templates</div>
        {#if templateList.length === 0}
          <div class="muted">No templates yet</div>
        {:else}
          {#each templateList as t}
            <div class="tmpl-row">
              <div class="tmpl-name">{t.name}</div>
              <div class="tmpl-vers">v{t.versions[t.versions.length - 1]} ({t.versions.length} versions)</div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .tabs { display: flex; gap: 6px; margin-left: auto; margin-right: 6px; }
  .tabs button { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 6px; padding: 3px 8px; cursor: pointer; font-size: 12px; }
  .tabs button.active { background: #2d6cdf; color: #fff; border-color: #2d6cdf; }
  .section { padding: 6px 0; border-top: 1px solid #f5f5f5; }
  .section:first-child { border-top: none; }
  .subheader { font-weight: 600; font-size: 12px; color: #111827; margin-bottom: 6px; }
  .row { display: grid; grid-template-columns: 150px 1fr auto; align-items: center; gap: 8px; margin: 6px 0; }
  .row.right { grid-template-columns: 1fr auto; }
  .row label { font-size: 12px; color: #374151; }
  .row input { width: 100%; padding: 4px 6px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 12px; }
  .row .actions { display: flex; gap: 6px; }
  .map-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px dashed #f0f0f0; }
  .map-row:last-child { border-bottom: none; }
  .field-label { font-size: 12px; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .arrow { color: #6b7280; font-size: 12px; }
  select { width: 100%; padding: 3px 6px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 12px; background: #fff; }
  .message { font-size: 12px; color: #14532d; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 6px; margin-top: 6px; }
  .muted { font-size: 12px; color: #6b7280; }
  .tmpl-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 4px 0; border-bottom: 1px dashed #f0f0f0; }
  .tmpl-row:last-child { border-bottom: none; }
  .tmpl-name { font-weight: 500; font-size: 12px; }
  .tmpl-vers { font-size: 12px; color: #6b7280; }
  .primary { background: #2d6cdf; color: #fff; border-color: #2d6cdf; }
</style>
