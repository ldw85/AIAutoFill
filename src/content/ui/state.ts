import { writable, derived, get } from 'svelte/store';
import type { Candidate, ScanResult } from '../domScanner';
import type { OntologyKey } from '../../lib/ontology';
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

export const keys = writable<KeyConfig[]>([]);
export const scan = writable<ScanResult | null>(null);
export const batch = writable<BatchMatchResult | null>(null);

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

export const candidatesView = derived([scan, batch, keys], ([$scan, $batch, $keys]) => {
  const out: CandidateView[] = [];
  if (!$scan || !$batch) return out;
  const byCand = $batch.byCandidate;
  for (const cand of $scan.candidates) {
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

export function updateScan(result: ScanResult, cfg?: Partial<MatcherConfig> & { semantic?: SemanticConfig }) {
  scan.set(result);
  void recomputeBatch(cfg);
}

export async function recomputeBatch(cfg?: Partial<MatcherConfig> & { semantic?: SemanticConfig }) {
  const s = get(scan);
  const k = get(keys).map((x) => x.key);
  if (!s || k.length === 0) {
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
  const b = computeBatchMatches(k, s.candidates, config);
  batch.set(b);

  // Optional semantic reranking (async)
  if (config.semantic?.enabled && config.semantic.apiUrl) {
    logSemanticPrivacyNoticeOnce(config.semantic);
    const reranked = await rerankWithSemantics(b, k, s.candidates, config);
    batch.set(reranked);
  }
}

// Apply/undo manager
interface AppliedInfo {
  id: string;
  original: unknown;
  appliedValue: unknown;
}

const applied = new Map<string, AppliedInfo>();

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

export function applyCandidate(cand: Candidate, match: MatchResult, value: unknown): FillResult | null {
  const el = getElementForCandidate(cand);
  if (!el) return null;
  const orig = getOriginalValue(el);
  const res = fillElement(el, value);
  if (res.changed) {
    applied.set(cand.id, { id: cand.id, original: orig, appliedValue: value });
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
  let count = 0;
  for (const cand of s.candidates) {
    if (undoCandidate(cand)) count++;
  }
  return count;
}

export function refreshHighlights() {
  const cvs = get(candidatesView);
  for (const v of cvs) {
    const el = getElementForCandidate(v.candidate);
    if (!el) continue;
    const applied = isApplied(v.candidate.id);
    const status: UIStatus | undefined = applied ? 'filled' : v.status;
    setHighlight(el, status);
  }
}
