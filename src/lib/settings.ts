const SETTINGS_STORAGE_KEY = 'aiaf.settings.v1';

export interface TemplateValues {
  [key: string]: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  values: TemplateValues;
  createdAt: number;
  updatedAt: number;
}

export interface ExtensionSettings {
  templates: TemplateDefinition[];
  quickFillTemplateId: string | null;
  quickExtractTemplateId: string | null;
  offlineMode: boolean;
  semanticMatching: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  templates: [],
  quickFillTemplateId: null,
  quickExtractTemplateId: null,
  offlineMode: false,
  semanticMatching: false
};

function now(): number {
  return Date.now();
}

function createTemplateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignore and fallback
  }
  return `tmpl-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function cloneValues(values?: TemplateValues | null): TemplateValues {
  const out: TemplateValues = {};
  if (!values) return out;
  for (const [key, value] of Object.entries(values)) {
    if (!key) continue;
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    out[normalizedKey] = typeof value === 'string' ? value : value != null ? String(value) : '';
  }
  return out;
}

function ensureTimestamp(input: unknown, fallback: number): number {
  return typeof input === 'number' && Number.isFinite(input) ? input : fallback;
}

function ensureTemplate(raw?: Partial<TemplateDefinition> | null): TemplateDefinition {
  const createdFallback = now();
  const values = cloneValues(raw?.values);
  const createdAt = ensureTimestamp(raw?.createdAt, createdFallback);
  const updatedAt = ensureTimestamp(raw?.updatedAt, createdAt);
  const name = (raw?.name || '').toString().trim() || 'Untitled Template';
  const id = (raw?.id && raw.id.toString().trim()) || createTemplateId();
  return {
    id,
    name,
    values,
    createdAt,
    updatedAt
  };
}

export function normalizeSettings(input?: Partial<ExtensionSettings> | null): ExtensionSettings {
  const base: ExtensionSettings = { ...DEFAULT_SETTINGS };
  const templates = Array.isArray(input?.templates)
    ? input!.templates.map((item) => ensureTemplate(item))
    : [];

  // Deduplicate by id, keeping the last occurrence (newest data last wins)
  const deduped: TemplateDefinition[] = [];
  for (const tmpl of templates) {
    const existingIndex = deduped.findIndex((t) => t.id === tmpl.id);
    if (existingIndex >= 0) {
      deduped[existingIndex] = tmpl;
    } else {
      deduped.push(tmpl);
    }
  }

  deduped.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const quickFillId = typeof input?.quickFillTemplateId === 'string' ? input?.quickFillTemplateId : null;
  const quickExtractId = typeof input?.quickExtractTemplateId === 'string' ? input?.quickExtractTemplateId : null;

  base.templates = deduped;
  base.offlineMode = Boolean(input?.offlineMode);

  // Semantic matching cannot be enabled when offline
  const semanticRequested = Boolean(input?.semanticMatching) && !base.offlineMode;
  base.semanticMatching = semanticRequested;

  const hasFill = quickFillId && deduped.some((t) => t.id === quickFillId) ? quickFillId : null;
  const hasExtract = quickExtractId && deduped.some((t) => t.id === quickExtractId) ? quickExtractId : null;

  base.quickFillTemplateId = hasFill;
  base.quickExtractTemplateId = hasExtract;

  return base;
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(result?.[key] as T | undefined);
    });
  });
}

function storageSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const raw = await storageGet<Partial<ExtensionSettings>>(SETTINGS_STORAGE_KEY);
    return normalizeSettings(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  update:
    | Partial<ExtensionSettings>
    | ExtensionSettings
    | ((prev: ExtensionSettings) => Partial<ExtensionSettings> | ExtensionSettings)
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const resolved = typeof update === 'function' ? update(current) : update;
  const nextRaw = { ...current, ...resolved };
  const normalized = normalizeSettings(nextRaw);
  await storageSet(SETTINGS_STORAGE_KEY, normalized);
  return normalized;
}

export function findTemplate(settings: ExtensionSettings, id?: string | null): TemplateDefinition | undefined {
  if (!id) return undefined;
  return settings.templates.find((t) => t.id === id);
}

export { SETTINGS_STORAGE_KEY };
