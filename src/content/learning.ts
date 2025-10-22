import type { MatchResult } from '../lib/fieldMatcher';
import type { Candidate } from './domScanner';
import {
  loadMappingPreferences,
  saveMappingPreferences,
  mappingPreferencesToSynonymOverlay,
  mappingPreferencesToPreferenceMap,
  type MappingPreferenceEntry,
  type MappingPreferenceInput
} from './templates';
import { setLearningState } from './ui/state';

let currentPassphrase: string | null = null;
let currentOrigin: string | null = null;
let currentPreferences: Map<string, MappingPreferenceEntry> = new Map();

function uniqStrings(values: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    out.add(trimmed);
  }
  return Array.from(out);
}

function collectCandidateStrings(candidate: Candidate): string[] {
  const attrs = candidate.attributes || {};
  return uniqStrings([
    candidate.accessibleName?.value ?? null,
    attrs.placeholder != null ? String(attrs.placeholder) : null,
    attrs['aria-label'] != null ? String(attrs['aria-label']) : null,
    attrs.title != null ? String(attrs.title) : null,
    attrs.name != null ? String(attrs.name) : null,
    attrs.id != null ? String(attrs.id) : null
  ]);
}

function selectPrimaryLabel(strings: string[]): { label: string; synonyms: string[] } | null {
  if (strings.length === 0) return null;
  const [first, ...rest] = strings;
  return { label: first, synonyms: rest };
}

function refreshLearningState(): void {
  const entries = Array.from(currentPreferences.values());
  if (!entries.length) {
    setLearningState({ synonyms: {}, preferences: {} });
    return;
  }
  const synonyms = mappingPreferencesToSynonymOverlay(entries);
  const preferences = mappingPreferencesToPreferenceMap(entries);
  setLearningState({ synonyms, preferences });
}

function applyPreferenceSnapshot(entries: MappingPreferenceEntry[]): void {
  currentPreferences = new Map(entries.map((entry) => [entry.labelNorm, entry]));
  refreshLearningState();
}

export function rememberPassphrase(passphrase: string, origin: string): void {
  const clean = passphrase.trim();
  if (!clean) {
    clearLearningContext();
    return;
  }
  const changed = clean !== currentPassphrase || origin !== currentOrigin;
  currentPassphrase = clean;
  currentOrigin = origin;
  if (changed) {
    currentPreferences = new Map();
    setLearningState({ synonyms: {}, preferences: {} });
  }
}

export function clearLearningContext(): void {
  currentPassphrase = null;
  currentOrigin = null;
  currentPreferences = new Map();
  setLearningState({ synonyms: {}, preferences: {} });
}

export function hasLearningContext(): boolean {
  return Boolean(currentPassphrase && currentOrigin);
}

export function getCurrentPreferences(): Map<string, MappingPreferenceEntry> {
  return new Map(currentPreferences);
}

export async function loadUserPreferences(passphrase: string, origin: string): Promise<Map<string, MappingPreferenceEntry>> {
  rememberPassphrase(passphrase, origin);
  if (!currentPassphrase || !currentOrigin) {
    currentPreferences = new Map();
    setLearningState({ synonyms: {}, preferences: {} });
    return new Map();
  }
  try {
    const loaded = await loadMappingPreferences(currentPassphrase, currentOrigin);
    currentPreferences = new Map(loaded);
    refreshLearningState();
    return new Map(currentPreferences);
  } catch (error) {
    console.warn('[AIAutoFill] failed to load mapping preferences', error);
    currentPreferences = new Map();
    setLearningState({ synonyms: {}, preferences: {} });
    return new Map();
  }
}

export async function saveUserPreferenceSelections(items: MappingPreferenceInput[]): Promise<Map<string, MappingPreferenceEntry>> {
  if (!currentPassphrase || !currentOrigin) return new Map(currentPreferences);
  if (!items.length) return new Map(currentPreferences);
  try {
    const merged = await saveMappingPreferences(currentPassphrase, currentOrigin, items);
    applyPreferenceSnapshot(merged);
  } catch (error) {
    console.warn('[AIAutoFill] failed to save mapping preferences', error);
  }
  return new Map(currentPreferences);
}

function buildPreferenceInputFromMatch(match: MatchResult): MappingPreferenceInput | null {
  const strings = collectCandidateStrings(match.candidate);
  const selected = selectPrimaryLabel(strings);
  if (!selected) return null;
  return {
    label: selected.label,
    key: match.key.key,
    synonyms: selected.synonyms
  };
}

export async function recordAppliedMatch(match: MatchResult): Promise<void> {
  if (!currentPassphrase || !currentOrigin) return;
  const input = buildPreferenceInputFromMatch(match);
  if (!input) return;
  try {
    const merged = await saveMappingPreferences(currentPassphrase, currentOrigin, [input]);
    applyPreferenceSnapshot(merged);
  } catch (error) {
    console.warn('[AIAutoFill] failed to record mapping adjustment', error);
  }
}

export function buildPreferenceInputsFromSelection(
  selection: Record<string, string>,
  candidates: Candidate[]
): MappingPreferenceInput[] {
  const inputs: MappingPreferenceInput[] = [];
  for (const cand of candidates) {
    const key = selection[cand.id];
    if (!key) continue;
    const strings = collectCandidateStrings(cand);
    const selected = selectPrimaryLabel(strings);
    if (!selected) continue;
    inputs.push({ label: selected.label, key, synonyms: selected.synonyms });
  }
  return inputs;
}
