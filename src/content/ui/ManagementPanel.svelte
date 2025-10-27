<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    batch,
    candidatesView,
    keys,
    panelOpen,
    scan,
    readCandidateValue,
    applyAll,
    undoAll,
    applyCandidate,
    undoCandidate,
    formGroups,
    selectedFormGroupId,
    setSelectedFormGroup
  } from './state';
  import type { CandidateView } from './state';
  import FormsTab from './FormsTab.svelte';
  import ExtractPersonalPanel from '../../ui/overlay/ExtractPersonalPanel.svelte';
  import ExtractSeoPanel from '../../ui/overlay/ExtractSeoPanel.svelte';
  import type { BatchMatchResult, MatchResult } from '../../lib/fieldMatcher';
  import {
    listTemplates,
    saveTemplate,
    extractValuesFromPage,
    normalizeLabel,
    type MappingPreferenceEntry
  } from '../templates';

  import {
    rememberPassphrase,
    loadUserPreferences,
    saveUserPreferenceSelections,
    buildPreferenceInputsFromSelection
  } from '../learning';

  let tab: 'forms' | 'preview' | 'personal' | 'seo' | 'templates' = 'forms';
  let passphrase = '';
  let templateName = '';
  let saving = false;
  let message = '';

  let templateList: Array<{ name: string; versions: number[] }> = [];

  // mapping selection per candidate id -> ontology key
  let selection: Record<string, string> = {};

  const VIRTUALIZATION_THRESHOLD = 100;
  const VIRTUAL_ROW_HEIGHT = 48;
  const VIRTUAL_OVERSCAN = 6;

  let candidateListEl: HTMLElement | null = null;
  let filteredCandidates: CandidateView[] = [];
  let visibleCandidates: CandidateView[] = [];
  let virtualizationEnabled = false;
  let totalCandidates = 0;
  let topSpacer = 0;
  let bottomSpacer = 0;
  let virtualStart = 0;
  let virtualEnd = 0;
  let resizeObserver: ResizeObserver | null = null;
  let lastGroupForList: string | null = null;

  function origin(): string { return location.origin; }

  function resetSelection() {
    selection = {};
    const cvs: CandidateView[] = $candidatesView;
    for (const cv of cvs) {
      if (!cv.best) continue;
      selection[cv.candidate.id] = cv.best.key.key;
    }
  }

  function normalizedCandidateLabels(cand: CandidateView['candidate']): string[] {
    const attrs = cand.attributes || {};
    const values = [
      cand.accessibleName?.value,
      attrs.placeholder,
      attrs['aria-label'],
      attrs.name,
      attrs.id
    ];
    const out: string[] = [];
    for (const value of values) {
      if (value == null) continue;
      const str = String(value).trim();
      if (!str) continue;
      const norm = normalizeLabel(str);
      if (!norm) continue;
      if (!out.includes(norm)) out.push(norm);
    }
    return out;
  }

  function initFromPrefs(map: Map<string, MappingPreferenceEntry>) {
    const cvs: CandidateView[] = $candidatesView;
    for (const cv of cvs) {
      const normalized = normalizedCandidateLabels(cv.candidate);
      for (const norm of normalized) {
        const pref = map.get(norm);
        if (pref) {
          selection[cv.candidate.id] = pref.key;
          break;
        }
      }
    }
  }

  function bestForKey(b: BatchMatchResult | null, key: string): MatchResult | undefined {
    if (!b) return undefined;
    const arr = b.byKey[key] || [];
    return arr[0];
  }

  async function refreshTemplates() {
    rememberPassphrase(passphrase, origin());
    if (!passphrase) { templateList = []; return; }
    templateList = await listTemplates(passphrase);
  }

  async function loadPrefs() {
    if (!passphrase) {
      rememberPassphrase('', origin());
      message = 'Enter passphrase to load preferences';
      return;
    }
    const map = await loadUserPreferences(passphrase, origin());
    resetSelection();
    initFromPrefs(map);
    message = 'Mapping preferences loaded for this site (if any)';
  }

  async function savePrefs() {
    if (!passphrase) { message = 'Enter passphrase to save preferences'; return; }
    rememberPassphrase(passphrase, origin());
    const s = $scan;
    if (!s) { message = 'No scan available'; return; }
    const inputs = buildPreferenceInputsFromSelection(selection, s.candidates);
    if (!inputs.length) { message = 'No mappings to save'; return; }
    await saveUserPreferenceSelections(inputs);
    message = 'Mapping preferences saved';
  }

  async function extractAndSave() {
    if (!passphrase) { message = 'Enter passphrase to save templates'; return; }
    rememberPassphrase(passphrase, origin());
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

  function triggerRescan() {
    try {
      (window as unknown as { __AIAutoFillOverlay__?: { rescan: () => void } }).__AIAutoFillOverlay__?.rescan();
    } catch (error) {
      console.warn('[AIAutoFill] failed to trigger rescan', error);
    }
  }

  function recomputeVirtualWindow() {
    if (!virtualizationEnabled) {
      virtualStart = 0;
      virtualEnd = totalCandidates;
      topSpacer = 0;
      bottomSpacer = 0;
      visibleCandidates = filteredCandidates;
      return;
    }
    const container = candidateListEl;
    if (!container) {
      virtualStart = 0;
      virtualEnd = Math.min(totalCandidates, VIRTUALIZATION_THRESHOLD);
      topSpacer = 0;
      bottomSpacer = Math.max(0, (totalCandidates - virtualEnd) * VIRTUAL_ROW_HEIGHT);
      visibleCandidates = filteredCandidates.slice(virtualStart, virtualEnd);
      return;
    }
    const scrollTop = container.scrollTop;
    const height = container.clientHeight || 0;
    const itemHeight = VIRTUAL_ROW_HEIGHT;
    const overscan = VIRTUAL_OVERSCAN;
    const visibleCount = Math.max(1, Math.ceil(height / itemHeight) + overscan * 2);
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(totalCandidates, start + visibleCount);
    virtualStart = start;
    virtualEnd = end;
    topSpacer = start * itemHeight;
    bottomSpacer = Math.max(0, (totalCandidates - end) * itemHeight);
    visibleCandidates = filteredCandidates.slice(start, end);
  }

  function handleListScroll() {
    if (!virtualizationEnabled) return;
    recomputeVirtualWindow();
  }

  function handleGroupChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    const value = target.value;
    if (value) {
      setSelectedFormGroup(value);
    }
  }

  $: filteredCandidates = $candidatesView;

  $: totalCandidates = filteredCandidates.length;

  $: virtualizationEnabled = totalCandidates > VIRTUALIZATION_THRESHOLD;

  $: recomputeVirtualWindow();

  $: {
    const currentGroup = $selectedFormGroupId;
    if (candidateListEl && currentGroup !== lastGroupForList) {
      candidateListEl.scrollTop = 0;
      lastGroupForList = currentGroup;
    }
  }

  $: {
    if (candidateListEl) {
      if (!resizeObserver && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => recomputeVirtualWindow());
        resizeObserver.observe(candidateListEl);
      }
    } else if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  }

  $: if ($scan) {
    const validIds = new Set($scan.candidates.map((cand) => cand.id));
    const staleIds = Object.keys(selection).filter((id) => !validIds.has(id));
    if (staleIds.length) {
      const next = { ...selection };
      for (const id of staleIds) delete next[id];
      selection = next;
    }
  }

  $: if (tab === 'templates') {
    recomputeVirtualWindow();
  }

  onMount(() => {
    resetSelection();
    recomputeVirtualWindow();
  });

  onDestroy(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  });
</script>

<div class="aiaf-panel" role="dialog" aria-label="AIAutoFill Panel">
  <header>
    <strong>AIAutoFill</strong>
    <div class="tabs">
      <button class:active={tab==='forms'} on:click={() => tab='forms'}>Forms</button>
      <button class:active={tab==='preview'} on:click={() => tab='preview'}>Preview</button>
      <button class:active={tab==='personal'} on:click={() => tab='personal'}>Personal</button>
      <button class:active={tab==='seo'} on:click={() => tab='seo'}>SEO</button>
      <button class:active={tab==='templates'} on:click={() => tab='templates'}>Templates</button>
    </div>
    <div class="header-actions">
      <button class="rescan-btn" type="button" on:click={triggerRescan} aria-label="Rescan fields">Rescan</button>
      <button class="close-btn" type="button" on:click={() => panelOpen.set(false)} aria-label="Close panel">×</button>
    </div>
  </header>

  {#if tab === 'forms'}
    <div class="body forms-body">
      <FormsTab />
    </div>
  {:else if tab === 'preview'}
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
  {:else if tab === 'personal'}
    <div class="body">
      <ExtractPersonalPanel />
    </div>
  {:else if tab === 'seo'}
    <div class="body">
      <ExtractSeoPanel />
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
        <div class="candidate-controls">
          <div class="summary">
            {#if $scan}
              Scan v{$scan.version} · {totalCandidates} field{totalCandidates === 1 ? '' : 's'}
              {#if virtualizationEnabled}
                · showing {visibleCandidates.length} at a time
              {/if}
            {:else}
              No scan yet
            {/if}
          </div>
          <div class="control-group">
            <label for="aiaf-group-filter">Group</label>
            <select
              id="aiaf-group-filter"
              on:change={handleGroupChange}
            >
              {#if $formGroups.length === 0}
                <option value="">No groups</option>
              {:else}
                {#each $formGroups as group}
                  <option value={group.id} selected={group.id === $selectedFormGroupId}>
                    {group.label} ({group.fieldCount})
                  </option>
                {/each}
              {/if}
            </select>
          </div>
        </div>
        <div
          class="candidate-list"
          bind:this={candidateListEl}
          on:scroll={handleListScroll}
        >
          {#if totalCandidates === 0}
            <div class="empty-state">No fields detected for this view.</div>
          {:else}
            <div style="height: {topSpacer}px;" aria-hidden="true"></div>
            {#each visibleCandidates as cv (cv.candidate.id)}
              <div class="map-row">
                <div class="field-info">
                  <div class="field-label">
                    {cv.candidate.accessibleName?.value
                      || cv.candidate.attributes?.placeholder
                      || cv.candidate.attributes?.name
                      || cv.candidate.tagName}
                  </div>
                  <div class="field-meta">
                    <span class="status {cv.status || 'unmatched'}">
                      {cv.status === 'pending'
                        ? 'matched'
                        : cv.status === 'uncertain'
                          ? 'uncertain'
                          : 'unmatched'}
                    </span>
                    {#if cv.candidate.formGroupLabel}
                      <span class="group-label">{cv.candidate.formGroupLabel}</span>
                    {/if}
                  </div>
                </div>
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
            {/each}
            <div style="height: {bottomSpacer}px;" aria-hidden="true"></div>
            <div class="end-sentinel">
              End of list · {totalCandidates} field{totalCandidates === 1 ? '' : 's'}
            </div>
          {/if}
        </div>
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
  header { display: flex; align-items: center; gap: 8px; }
  .tabs { display: flex; gap: 6px; margin-left: auto; margin-right: 6px; }
  .tabs button { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 6px; padding: 3px 8px; cursor: pointer; font-size: 12px; }
  .tabs button.active { background: #2d6cdf; color: #fff; border-color: #2d6cdf; }
  .header-actions { display: flex; gap: 6px; align-items: center; }
  .rescan-btn { background: #f9fafb; border: 1px solid #d1d5db; border-radius: 6px; padding: 3px 8px; font-size: 12px; cursor: pointer; color: #1f2937; }
  .rescan-btn:hover { background: #eef2ff; border-color: #c7d2fe; }
  .close-btn { background: transparent; border: none; font-size: 16px; line-height: 1; cursor: pointer; color: #6b7280; padding: 2px 6px; }
  .close-btn:hover { color: #111827; }
  .section { padding: 6px 0; border-top: 1px solid #f5f5f5; }
  .section:first-child { border-top: none; }
  .subheader { font-weight: 600; font-size: 12px; color: #111827; margin-bottom: 6px; }
  .row { display: grid; grid-template-columns: 150px 1fr auto; align-items: center; gap: 8px; margin: 6px 0; }
  .row.right { grid-template-columns: 1fr auto; }
  .row label { font-size: 12px; color: #374151; }
  .row input { width: 100%; padding: 4px 6px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 12px; }
  .row .actions { display: flex; gap: 6px; }
  .candidate-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .candidate-controls .summary { font-size: 12px; color: #374151; }
  .candidate-controls .control-group { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #374151; }
  .candidate-controls .control-group select { width: auto; min-width: 160px; }
  .candidate-list { max-height: 320px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 4px 0; background: #fff; }
  .candidate-list select { width: 100%; }
  .map-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(140px, 200px); align-items: center; gap: 12px; }
  .candidate-list .map-row { padding: 6px 12px; }
  .candidate-list .map-row + .map-row { border-top: 1px dashed #f0f0f0; }
  .field-info { display: flex; flex-direction: column; gap: 4px; }
  .field-label { font-size: 12px; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .field-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #6b7280; }
  .status { text-transform: uppercase; font-weight: 600; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 999px; border: 1px solid transparent; }
  .status.pending { background: #ecfdf5; color: #047857; border-color: #bbf7d0; }
  .status.uncertain { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
  .status.unmatched { background: #f3f4f6; color: #4b5563; border-color: #e5e7eb; }
  .group-label { max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .arrow { color: #6b7280; font-size: 12px; }
  select { width: 100%; padding: 3px 6px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 12px; background: #fff; }
  .message { font-size: 12px; color: #14532d; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 6px; margin-top: 6px; }
  .muted { font-size: 12px; color: #6b7280; }
  .end-sentinel { padding: 8px 0; text-align: center; font-size: 11px; color: #6b7280; }
  .empty-state { padding: 16px; text-align: center; font-size: 12px; color: #6b7280; }
  .tmpl-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 4px 0; border-bottom: 1px dashed #f0f0f0; }
  .tmpl-row:last-child { border-bottom: none; }
  .tmpl-name { font-weight: 500; font-size: 12px; }
  .tmpl-vers { font-size: 12px; color: #6b7280; }
  .primary { background: #2d6cdf; color: #fff; border-color: #2d6cdf; }
</style>
