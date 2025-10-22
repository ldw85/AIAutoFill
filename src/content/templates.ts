import type { Candidate } from './domScanner';
import { loadEncrypted, saveEncrypted } from '../lib/secureStore';

export interface TemplateVersion {
  name: string;
  version: number;
  createdAt: number;
  data: Record<string, unknown>;
}

export interface TemplateStore {
  templates: Record<string, TemplateVersion[]>; // name -> versions ascending by version
}

export interface MappingPreferenceEntry {
  labelNorm: string;
  key: string;
  weight: number;
  label?: string;
  synonyms?: string[];
  updatedAt: number;
}

export interface MappingPreferenceStore {
  byOrigin: Record<string, { items: MappingPreferenceEntry[]; updatedAt: number }>;
}

export interface MappingPreferenceInput {
  label: string;
  key: string;
  weightDelta?: number;
  synonyms?: string[];
}

export interface PreferenceMapEntry {
  key: string;
  weight: number;
  label?: string;
  updatedAt?: number;
}

export type PreferenceMap = Record<string, PreferenceMapEntry[]>;

const TEMPLATES_KEY = 'aiaf.templates';
const PREFS_KEY = 'aiaf.mappingPrefs';

function uniqStrings(values: Array<string | undefined | null>): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    out.add(trimmed);
  }
  return Array.from(out);
}

export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveSynonyms(label: string, extras?: string[]): string[] {
  const tokens = label
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  return uniqStrings([
    label,
    label.toLowerCase(),
    ...tokens,
    ...(extras || [])
  ]);
}

function ensurePreferenceEntry(raw: Partial<MappingPreferenceEntry> & { labelNorm: string; key: string }): MappingPreferenceEntry {
  const weight = typeof raw.weight === 'number' && Number.isFinite(raw.weight) && raw.weight > 0 ? raw.weight : 1;
  const synonyms = Array.isArray(raw.synonyms) ? raw.synonyms.filter((s) => typeof s === 'string' && s.trim().length > 0) : [];
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now();
  return {
    labelNorm: raw.labelNorm,
    key: raw.key,
    weight,
    label: raw.label,
    synonyms,
    updatedAt
  };
}

export async function listTemplates(passphrase: string): Promise<Array<{ name: string; versions: number[] }>> {
  const store = (await loadEncrypted<TemplateStore>(TEMPLATES_KEY, passphrase)) || { templates: {} };
  const out: Array<{ name: string; versions: number[] }> = [];
  for (const [name, versions] of Object.entries(store.templates)) {
    out.push({ name, versions: versions.map((v) => v.version) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveTemplate(passphrase: string, name: string, data: Record<string, unknown>): Promise<number> {
  const store = (await loadEncrypted<TemplateStore>(TEMPLATES_KEY, passphrase)) || { templates: {} };
  const list = store.templates[name] || [];
  const version = (list[list.length - 1]?.version || 0) + 1;
  const entry: TemplateVersion = { name, version, createdAt: Date.now(), data };
  store.templates[name] = [...list, entry];
  await saveEncrypted(TEMPLATES_KEY, store, passphrase);
  return version;
}

function mergePreferenceEntries(existing: MappingPreferenceEntry[], updates: MappingPreferenceInput[]): MappingPreferenceEntry[] {
  const map = new Map<string, MappingPreferenceEntry>();
  for (const raw of existing) {
    const entry = ensurePreferenceEntry(raw);
    map.set(entry.labelNorm, entry);
  }

  const now = Date.now();
  for (const update of updates) {
    if (!update.label || !update.key) continue;
    const label = update.label.trim();
    if (!label) continue;
    const labelNorm = normalizeLabel(label);
    if (!labelNorm) continue;
    const delta = typeof update.weightDelta === 'number' && Number.isFinite(update.weightDelta) ? update.weightDelta : 1;
    const extras = deriveSynonyms(label, update.synonyms);
    const existingEntry = map.get(labelNorm);
    if (existingEntry) {
      if (existingEntry.key === update.key) {
        existingEntry.weight = Math.max(1, existingEntry.weight + delta);
      } else {
        existingEntry.key = update.key;
        existingEntry.weight = Math.max(1, delta);
      }
      existingEntry.label = label;
      existingEntry.synonyms = uniqStrings([...(existingEntry.synonyms || []), ...extras]);
      existingEntry.updatedAt = now;
    } else {
      map.set(labelNorm, {
        labelNorm,
        key: update.key,
        weight: Math.max(1, delta),
        label,
        synonyms: extras,
        updatedAt: now
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.labelNorm.localeCompare(b.labelNorm));
}

export async function saveMappingPreferences(
  passphrase: string,
  origin: string,
  items: MappingPreferenceInput[]
): Promise<MappingPreferenceEntry[]> {
  const store = (await loadEncrypted<MappingPreferenceStore>(PREFS_KEY, passphrase)) || { byOrigin: {} };
  const current = store.byOrigin[origin]?.items || [];
  const merged = mergePreferenceEntries(current, items);
  store.byOrigin[origin] = { items: merged, updatedAt: Date.now() };
  await saveEncrypted(PREFS_KEY, store, passphrase);
  return merged;
}

export async function loadMappingPreferences(
  passphrase: string,
  origin: string
): Promise<Map<string, MappingPreferenceEntry>> {
  const store = (await loadEncrypted<MappingPreferenceStore>(PREFS_KEY, passphrase)) || { byOrigin: {} };
  const site = store.byOrigin[origin];
  const out = new Map<string, MappingPreferenceEntry>();
  if (site) {
    for (const raw of site.items) {
      const entry = ensurePreferenceEntry(raw);
      out.set(entry.labelNorm, entry);
    }
  }
  return out;
}

export function mappingPreferencesToSynonymOverlay(entries: Iterable<MappingPreferenceEntry>): Record<string, string[]> {
  const buckets = new Map<string, Set<string>>();
  for (const entry of entries) {
    const set = buckets.get(entry.key) || new Set<string>();
    if (entry.label) set.add(entry.label);
    for (const syn of entry.synonyms || []) set.add(syn);
    set.add(entry.labelNorm);
    buckets.set(entry.key, set);
  }
  const out: Record<string, string[]> = {};
  for (const [key, set] of buckets.entries()) {
    out[key] = Array.from(set);
  }
  return out;
}

export function mappingPreferencesToPreferenceMap(entries: Iterable<MappingPreferenceEntry>): PreferenceMap {
  const pref: PreferenceMap = {};
  for (const entry of entries) {
    const list = pref[entry.labelNorm] || [];
    list.push({ key: entry.key, weight: entry.weight, label: entry.label, updatedAt: entry.updatedAt });
    pref[entry.labelNorm] = list;
  }
  for (const key of Object.keys(pref)) {
    pref[key].sort((a, b) => b.weight - a.weight || (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return pref;
}

export function extractValuesFromPage(
  selection: Record<string, string>, // candidateId -> ontologyKey
  candidates: Candidate[],
  reader: (cand: Candidate) => unknown
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const cand of candidates) {
    const key = selection[cand.id];
    if (!key) continue;
    const val = reader(cand);
    if (val != null && val !== '') values[key] = val as unknown;
  }
  return values;
}
