import { writable, derived, get } from 'svelte/store';
import type { Candidate, ScanResult, FormGroup, Rect } from '../domScanner';
import type { OntologyKey } from '../../lib/ontology';
import type { Mode, RuntimeSettings, TemplateModel } from '../../core/model/schemas';
import {
  DEFAULT_MATCHER_CONFIG,
  type MatcherConfig,
  type PreferenceMap,
  type PreferenceRecord
} from '../../lib/ontology';
import { computeBatchMatches, type BatchMatchResult, type MatchResult } from '../../lib/fieldMatcher';
import { rerankWithSemantics, type SemanticConfig, logSemanticPrivacyNoticeOnce } from '../../lib/semantic';
import { fillElement, type FillResult } from '../filler';

export type UIStatus = 'pending' | 'filled' | 'uncertain';

export interface KeyConfig {
  key: OntologyKey;
  // value to fill for this key
  value?: string | string[] | boolean;
}

export interface CandidateView {
  candidate: Candidate;
  best?: MatchResult;
  key?: OntologyKey;
  status?: UIStatus;
  hasValue?: boolean;
  applied?: boolean;
}

export const overlayVisible = writable(true);
export const panelOpen = writable(false);

export const runtimeSettings = writable<RuntimeSettings | null>(null);
export const effectiveMode = writable<Mode>('offline');
export const sessionUnlocked = writable(false);
export const semanticEndpoint = writable('');
export const templatesStore = writable<TemplateModel[]>([]);

export const keys = writable<KeyConfig[]>([]);
export const scan = writable<ScanResult | null>(null);
export const batch = writable<BatchMatchResult | null>(null);
export const formGroups = writable<FormGroup[]>([]);
export const selectedFormGroupId = writable<string | null>(null);
export const hoveredFormGroupId = writable<string | null>(null);

let candidateIndex = new Map<string, Candidate>();
let lastSelectedGroupId: string | null = null;
let groupHighlightSelected: HTMLDivElement | null = null;
let groupHighlightHover: HTMLDivElement | null = null;
let highlightListenersAttached = false;
let currentSelectedHighlightId: string | null = null;
let currentHoveredHighlightId: string | null = null;

interface LearningState {
  synonyms: Record<string, string[]>;
  preferences: PreferenceMap;
}

const defaultLearningState: LearningState = { synonyms: {}, preferences: {} };

export const learningConfig = writable<LearningState>(defaultLearningState);

export function getLearningState(): LearningState {
  return get(learningConfig);
}

export function setLearningState(state: LearningState, options?: { recompute?: boolean }) {
  learningConfig.set(state);
  if (options?.recompute !== false) void recomputeBatch();
}

export function updateLearningState(partial: Partial<LearningState>, options?: { recompute?: boolean }) {
  learningConfig.update((prev) => ({
    synonyms: partial.synonyms ?? prev.synonyms,
    preferences: partial.preferences ?? prev.preferences
  }));
  if (options?.recompute !== false) void recomputeBatch();
}

function mergeSynonymSources(...sources: Array<Record<string, string[]> | undefined>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [key, list] of Object.entries(src)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      const existing = result[key] || [];
      const merged = [...existing, ...list]
        .map((value) => (value ?? '').toString().trim())
        .filter((value) => value.length > 0);
      result[key] = Array.from(new Set(merged));
    }
  }
  return result;
}

function mergePreferenceSources(...sources: Array<PreferenceMap | undefined>): PreferenceMap {
  const result: PreferenceMap = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [label, entries] of Object.entries(src)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      if (!result[label]) result[label] = [];
      result[label].push(...entries);
    }
  }
  for (const [label, entries] of Object.entries(result)) {
    const byKey = new Map<string, PreferenceRecord>();
    for (const entry of entries) {
      if (!entry?.key) continue;
      const existing = byKey.get(entry.key);
      if (!existing) {
        byKey.set(entry.key, { ...entry });
        continue;
      }
      const existingWeight = existing.weight ?? 0;
      const incomingWeight = entry.weight ?? 0;
      if (
        incomingWeight > existingWeight ||
        (incomingWeight === existingWeight && (entry.updatedAt ?? 0) > (existing.updatedAt ?? 0))
      ) {
        byKey.set(entry.key, { ...entry });
      }
    }
    const merged = Array.from(byKey.values());
    merged.sort(
      (a, b) =>
        (b.weight ?? 0) - (a.weight ?? 0) ||
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    );
    result[label] = merged;
  }
  return result;
}

export const candidatesView = derived([scan, batch, keys, selectedFormGroupId], ([$scan, $batch, $keys, $selectedGroup]) => {
  const out: CandidateView[] = [];
  if (!$scan || !$batch) return out;
  const byCand = $batch.byCandidate;
  const candidates = $selectedGroup
    ? $scan.candidates.filter((cand) => cand.formGroupId === $selectedGroup)
    : $scan.candidates;
  for (const cand of candidates) {
    const results = byCand[cand.id] || [];
    const best = results[0];
    const view: CandidateView = { candidate: cand };
    if (best) {
      view.best = best;
      const kc = $keys.find((k) => k.key.key === best.key.key);
      view.key = best.key;
      view.hasValue = kc?.value != null;
      if (best.tier === 'accept') view.status = 'pending';
      else if (best.tier === 'consider') view.status = 'uncertain';
      else view.status = undefined;
    }
    out.push(view);
  }
  return out;
});

export function setKeys(list: KeyConfig[], cfg?: Partial<MatcherConfig> & { semantic?: SemanticConfig }) {
  keys.set(list);
  void recomputeBatch(cfg);
}

function candidatesForGroup(all: Candidate[], groupId: string | null): Candidate[] {
  if (!groupId) return all;
  return all.filter((cand) => cand.formGroupId === groupId);
}

function internalSetSelectedFormGroup(id: string | null, options?: { silent?: boolean }) {
  const current = get(selectedFormGroupId);
  if (current === id) {
    if (!options?.silent) {
      refreshGroupHighlightPositions();
    }
    return;
  }
  selectedFormGroupId.set(id);
  lastSelectedGroupId = id;
  if (options?.silent) {
    refreshGroupHighlightPositions();
    return;
  }
  void (async () => {
    await recomputeBatch();
    refreshHighlights();
    refreshGroupHighlightPositions();
  })();
}

function ensureSelectionForScan(result: ScanResult): void {
  const groups = result.formGroups || [];
  if (!groups.length) {
    lastSelectedGroupId = null;
    if (get(selectedFormGroupId) !== null) {
      selectedFormGroupId.set(null);
    }
    return;
  }
  const current = get(selectedFormGroupId);
  if (current && groups.some((g) => g.id === current)) {
    lastSelectedGroupId = current;
    return;
  }
  if (lastSelectedGroupId && groups.some((g) => g.id === lastSelectedGroupId)) {
    internalSetSelectedFormGroup(lastSelectedGroupId, { silent: true });
    return;
  }
  const firstId = groups[0]?.id ?? null;
  internalSetSelectedFormGroup(firstId, { silent: true });
}

export function setSelectedFormGroup(id: string): void {
  internalSetSelectedFormGroup(id, { silent: false });
}

export function setHoveredFormGroup(id: string | null): void {
  hoveredFormGroupId.set(id);
}

export function clearHoveredFormGroup(): void {
  hoveredFormGroupId.set(null);
}

export async function fillAllGroups(): Promise<number> {
  const groups = get(formGroups);
  if (!groups.length) return 0;
  const original = get(selectedFormGroupId);
  let total = 0;
  for (const group of groups) {
    internalSetSelectedFormGroup(group.id, { silent: true });
    await recomputeBatch();
    total += applyAll();
  }
  if (original && groups.some((g) => g.id === original)) {
    internalSetSelectedFormGroup(original, { silent: true });
  } else if (groups.length) {
    internalSetSelectedFormGroup(groups[0].id, { silent: true });
  } else {
    internalSetSelectedFormGroup(null, { silent: true });
  }
  await recomputeBatch();
  refreshHighlights();
  refreshGroupHighlightPositions();
  return total;
}

export function updateScan(result: ScanResult, cfg?: Partial<MatcherConfig> & { semantic?: SemanticConfig }) {
  const current = get(scan);
  if (current && result.version <= current.version) {
    return;
  }
  scan.set(result);
  candidateIndex = new Map(result.candidates.map((cand) => [cand.id, cand]));
  formGroups.set(result.formGroups);
  ensureSelectionForScan(result);
  pruneAppliedForCurrentScan(result);
  refreshGroupHighlightPositions();
  void recomputeBatch(cfg);
}

export async function recomputeBatch(cfg?: Partial<MatcherConfig> & { semantic?: SemanticConfig }) {
  const s = get(scan);
  const selectedGroup = get(selectedFormGroupId);
  const k = get(keys).map((x) => x.key);
  if (!s || k.length === 0) {
    batch.set(null);
    return;
  }
  const candidates = candidatesForGroup(s.candidates, selectedGroup);
  if (!candidates.length) {
    batch.set(null);
    return;
  }
  const learning = get(learningConfig);
  const synonyms = mergeSynonymSources(
    DEFAULT_MATCHER_CONFIG.synonyms,
    cfg?.synonyms,
    learning.synonyms
  );
  const preferences = mergePreferenceSources(
    DEFAULT_MATCHER_CONFIG.preferences,
    cfg?.preferences,
    learning.preferences
  );
  const config: MatcherConfig & { semantic?: SemanticConfig } = {
    ...DEFAULT_MATCHER_CONFIG,
    ...cfg,
    thresholds: { ...DEFAULT_MATCHER_CONFIG.thresholds, ...(cfg?.thresholds || {}) },
    weights: { ...DEFAULT_MATCHER_CONFIG.weights, ...(cfg?.weights || {}) },
    synonyms,
    preferences,
    semantic: cfg?.semantic
  } as MatcherConfig & { semantic?: SemanticConfig };
  const b = computeBatchMatches(k, candidates, config);
  batch.set(b);

  // Optional semantic reranking (async)
  if (config.semantic?.enabled && config.semantic.apiUrl) {
    logSemanticPrivacyNoticeOnce(config.semantic);
    const reranked = await rerankWithSemantics(b, k, candidates, config);
    batch.set(reranked);
  }
}

// Apply/undo manager
interface AppliedInfo {
  id: string;
  original: unknown;
  appliedValue: unknown;
  path: string;
  framePath: string[];
}

const applied = new Map<string, AppliedInfo>();

function resolveElementFromApplied(info: AppliedInfo): HTMLElement | null {
  try {
    let root: Document | ShadowRoot | null = document;
    if (info.framePath && info.framePath.length) {
      for (const sel of info.framePath) {
        const iframe = root.querySelector(sel) as HTMLIFrameElement | null;
        if (!iframe || !iframe.contentDocument) return null;
        root = iframe.contentDocument;
      }
    }
    const el = root.querySelector(info.path);
    return el instanceof HTMLElement ? el : null;
  } catch {
    return null;
  }
}

function pruneAppliedForCurrentScan(result: ScanResult | null) {
  if (!result) {
    for (const info of applied.values()) {
      const el = resolveElementFromApplied(info);
      if (el) setHighlight(el, undefined);
    }
    applied.clear();
    return;
  }
  const validIds = new Set(result.candidates.map((cand) => cand.id));
  for (const [id, info] of Array.from(applied.entries())) {
    if (validIds.has(id)) continue;
    const el = resolveElementFromApplied(info);
    if (el) setHighlight(el, undefined);
    applied.delete(id);
  }
}

export function getElementForCandidate(cand: Candidate): HTMLElement | null {
  try {
    let root: Document | ShadowRoot | null = document;
    if (cand.framePath && cand.framePath.length) {
      for (const sel of cand.framePath) {
        const iframe = root.querySelector(sel) as HTMLIFrameElement | null;
        if (!iframe || !iframe.contentDocument) return null;
        root = iframe.contentDocument;
      }
    }
    const el = root.querySelector(cand.path);
    return el instanceof HTMLElement ? el : null;
  } catch {
    return null;
  }
}

function getOriginalValue(el: HTMLElement): unknown {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) {
    if (el.multiple) return Array.from(el.selectedOptions).map((o) => o.value);
    return el.value;
  }
  return el.textContent;
}

export function readCandidateValue(cand: Candidate): unknown {
  const el = getElementForCandidate(cand);
  if (!el) return null;
  return getOriginalValue(el);
}

function setHighlight(el: HTMLElement, status?: UIStatus) {
  el.classList.remove('aiaf-highlight-pending', 'aiaf-highlight-uncertain', 'aiaf-highlight-filled');
  if (!status) return;
  if (status === 'pending') el.classList.add('aiaf-highlight-pending');
  if (status === 'uncertain') el.classList.add('aiaf-highlight-uncertain');
  if (status === 'filled') el.classList.add('aiaf-highlight-filled');
}

const GROUP_HIGHLIGHT_PADDING = 8;

function ensureGroupHighlightLayers(): void {
  if (groupHighlightSelected && groupHighlightHover) return;
  const root = document.body || document.documentElement;
  if (!root) return;
  if (!groupHighlightSelected) {
    groupHighlightSelected = document.createElement('div');
    groupHighlightSelected.className = 'aiaf-formgroup-highlight selected';
    groupHighlightSelected.setAttribute('aria-hidden', 'true');
    root.appendChild(groupHighlightSelected);
  }
  if (!groupHighlightHover) {
    groupHighlightHover = document.createElement('div');
    groupHighlightHover.className = 'aiaf-formgroup-highlight hover';
    groupHighlightHover.setAttribute('aria-hidden', 'true');
    root.appendChild(groupHighlightHover);
  }
  if (!highlightListenersAttached) {
    const handler = () => refreshGroupHighlightPositions();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler, true);
    highlightListenersAttached = true;
  }
}

function positionHighlightElement(target: HTMLDivElement | null, rect: Rect | null): void {
  if (!target) return;
  if (!rect) {
    target.style.display = 'none';
    return;
  }
  const pad = GROUP_HIGHLIGHT_PADDING;
  const width = Math.max(0, rect.width + pad * 2);
  const height = Math.max(0, rect.height + pad * 2);
  const top = Math.max(0, rect.top - pad);
  const left = Math.max(0, rect.left - pad);
  target.style.display = 'block';
  target.style.top = `${top}px`;
  target.style.left = `${left}px`;
  target.style.width = `${width}px`;
  target.style.height = `${height}px`;
}

function computeCandidateViewportRect(cand: Candidate): Rect | null {
  const el = getElementForCandidate(cand);
  if (!el) return null;
  try {
    const baseRect = el.getBoundingClientRect();
    let top = baseRect.top;
    let left = baseRect.left;
    let right = baseRect.right;
    let bottom = baseRect.bottom;
    if (cand.framePath && cand.framePath.length) {
      let root: Document | ShadowRoot | null = document;
      for (const sel of cand.framePath) {
        const frame = root?.querySelector(sel) as HTMLIFrameElement | null;
        if (!frame) return null;
        const frameRect = frame.getBoundingClientRect();
        top += frameRect.top;
        bottom += frameRect.top;
        left += frameRect.left;
        right += frameRect.left;
        root = frame.contentDocument;
      }
    }
    return {
      top,
      left,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  } catch {
    return null;
  }
}

function computeGroupViewportRect(groupId: string | null): Rect | null {
  if (!groupId) return null;
  const currentScan = get(scan);
  if (!currentScan) return null;
  const group = currentScan.formGroups.find((g) => g.id === groupId);
  if (!group) return null;
  let top = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const candId of group.candidateIds) {
    const cand = candidateIndex.get(candId);
    if (!cand) continue;
    const rect = computeCandidateViewportRect(cand);
    if (!rect) continue;
    found = true;
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!found) {
    const fallback = group.outlineRect;
    if (!fallback) return null;
    return fallback;
  }
  return {
    top,
    left,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function applyGroupHighlight(kind: 'selected' | 'hover', groupId: string | null): void {
  ensureGroupHighlightLayers();
  const rect = computeGroupViewportRect(groupId);
  if (kind === 'selected') {
    positionHighlightElement(groupHighlightSelected, rect);
  } else {
    positionHighlightElement(groupHighlightHover, rect);
  }
}

function refreshGroupHighlightPositions(): void {
  if (currentSelectedHighlightId) {
    applyGroupHighlight('selected', currentSelectedHighlightId);
  } else if (groupHighlightSelected) {
    groupHighlightSelected.style.display = 'none';
  }
  if (currentHoveredHighlightId) {
    applyGroupHighlight('hover', currentHoveredHighlightId);
  } else if (groupHighlightHover) {
    groupHighlightHover.style.display = 'none';
  }
}

selectedFormGroupId.subscribe((id) => {
  currentSelectedHighlightId = id;
  applyGroupHighlight('selected', id);
});

hoveredFormGroupId.subscribe((id) => {
  currentHoveredHighlightId = id;
  applyGroupHighlight('hover', id);
});

export function applyCandidate(cand: Candidate, match: MatchResult, value: unknown): FillResult | null {
  const el = getElementForCandidate(cand);
  if (!el) return null;
  const orig = getOriginalValue(el);
  const res = fillElement(el, value);
  if (res.changed) {
    applied.set(cand.id, {
      id: cand.id,
      original: orig,
      appliedValue: value,
      path: cand.path,
      framePath: cand.framePath
    });
    setHighlight(el, 'filled');
    void import('../learning')
      .then(({ recordAppliedMatch }) => {
        if (typeof recordAppliedMatch === 'function') {
          return recordAppliedMatch(match);
        }
        return undefined;
      })
      .catch(() => undefined);
  }
  return res;
}

export function undoCandidate(cand: Candidate): boolean {
  const info = applied.get(cand.id);
  if (!info) return false;
  const el = getElementForCandidate(cand);
  if (!el) return false;
  const res = fillElement(el, info.original as unknown);
  applied.delete(cand.id);
  setHighlight(el, undefined);
  void res; // ignore
  return true;
}

export function isApplied(id: string): boolean {
  return applied.has(id);
}

export function applyAll(): number {
  const b = get(batch);
  const k = get(keys);
  if (!b) return 0;
  let count = 0;
  for (const one of Object.values(b.byKey)) {
    const best = one[0];
    if (!best) continue;
    const kc = k.find((x) => x.key.key === best.key.key);
    if (!kc || kc.value == null) continue;
    if (best.tier === 'reject') continue;
    const res = applyCandidate(best.candidate, best, kc.value);
    if (res?.changed) count++;
  }
  return count;
}

export function undoAll(): number {
  const s = get(scan);
  if (!s) return 0;
  const selectedGroup = get(selectedFormGroupId);
  const candidates = candidatesForGroup(s.candidates, selectedGroup);
  let count = 0;
  for (const cand of candidates) {
    if (undoCandidate(cand)) count++;
  }
  return count;
}

export function refreshHighlights() {
  const currentScan = get(scan);
  if (!currentScan) return;
  const cvs = get(candidatesView);
  const viewById = new Map<string, CandidateView>();
  for (const view of cvs) {
    viewById.set(view.candidate.id, view);
  }
  for (const cand of currentScan.candidates) {
    const el = getElementForCandidate(cand);
    if (!el) continue;
    const applied = isApplied(cand.id);
    const view = viewById.get(cand.id);
    const status: UIStatus | undefined = applied ? 'filled' : view?.status;
    setHighlight(el, status);
  }
}
