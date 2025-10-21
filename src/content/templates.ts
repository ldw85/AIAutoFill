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

export interface MappingPreferenceItem {
  labelNorm: string; // normalized accessible label
  key: string; // ontology key
}

export interface MappingPreferenceStore {
  byOrigin: Record<string, { items: MappingPreferenceItem[]; updatedAt: number }>;
}

const TEMPLATES_KEY = 'aiaf.templates';
const PREFS_KEY = 'aiaf.mappingPrefs';

function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export async function saveMappingPreferences(
  passphrase: string,
  origin: string,
  items: Array<{ label: string; key: string }>
): Promise<void> {
  const store = (await loadEncrypted<MappingPreferenceStore>(PREFS_KEY, passphrase)) || { byOrigin: {} };
  const normalized: MappingPreferenceItem[] = items
    .filter((x) => x.label && x.key)
    .map((x) => ({ labelNorm: normalizeLabel(x.label), key: x.key }));
  store.byOrigin[origin] = { items: normalized, updatedAt: Date.now() };
  await saveEncrypted(PREFS_KEY, store, passphrase);
}

export async function loadMappingPreferences(
  passphrase: string,
  origin: string
): Promise<Map<string, string>> {
  const store = (await loadEncrypted<MappingPreferenceStore>(PREFS_KEY, passphrase)) || { byOrigin: {} };
  const site = store.byOrigin[origin];
  const out = new Map<string, string>();
  if (site) {
    for (const it of site.items) out.set(it.labelNorm, it.key);
  }
  return out;
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
