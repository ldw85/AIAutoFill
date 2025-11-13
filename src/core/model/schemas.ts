import { z } from 'zod';

export const informationFieldKeys = [
  'web.url',
  'web.site_title',
  'web.description',
  'web.keywords',
  'web.canonical_url',
  'web.og_title',
  'web.og_description',
  'web.category',
  'web.tagline',
  'contact.email',
  'contact.phone',
  'contact.address',
  'contact.city',
  'contact.state',
  'contact.postal_code',
  'identity.full_name',
  'identity.first_name',
  'identity.last_name',
  'identity.job_title',
  'identity.company',
  'identity.bio',
  'social.linkedin',
  'social.twitter',
  'social.youtube',
  'social.facebook'
] as const;

const informationFieldSet = new Set<string>(informationFieldKeys);

export function isKnownInformationKey(value: string): value is InformationFieldKey {
  return informationFieldSet.has(value);
}

export type InformationFieldKey = (typeof informationFieldKeys)[number];

const TEMPLATE_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export const keyFormatHint =
  'Keys can include letters, numbers, dots, underscores, or hyphens (e.g., identity.full_name).';

export function normalizeKey(input: string): string {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, '_');
}

export function isValidTemplateKey(input: string): boolean {
  if (!input) return false;
  return TEMPLATE_KEY_PATTERN.test(input);
}

export type Mode = 'offline' | 'semantic';

export interface TemplateFieldInput {
  key: string;
  value: string;
}

export type TemplateValues = Record<string, string>;

export interface TemplateModel {
  id: string;
  label: string;
  values: TemplateValues;
  createdAt: number;
  updatedAt: number;
}

export interface SiteOverride {
  pattern: string;
  mode: Mode;
}

export interface RuntimeSettings {
  mode: Mode;
  overrides: SiteOverride[];
  semanticEndpoint: string;
}

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  mode: 'offline',
  overrides: [],
  semanticEndpoint: ''
};

const templateFieldSchema = z.object({
  key: z
    .string()
    .transform((value) => normalizeKey(value))
    .refine((value) => value.length > 0, { message: 'Key is required' })
    .refine((value) => isValidTemplateKey(value), {
      message: 'Keys may include letters, numbers, dots, underscores, or hyphens'
    }),
  value: z.string().trim().min(1, 'Value is required')
});

const templateUpsertSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    label: z.string().trim().min(1, 'Template name is required'),
    fields: z.array(templateFieldSchema).nonempty('Add at least one field')
  })
  .transform((data) => ({
    id: data.id,
    label: data.label,
    fields: data.fields
  }));

export type TemplateUpsert = z.infer<typeof templateUpsertSchema>;

function normaliseValue(key: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (key === 'contact.email') {
    return trimmed.toLowerCase();
  }
  if (key === 'identity.full_name' || key === 'identity.first_name' || key === 'identity.last_name') {
    return trimmed.replace(/\s+/g, ' ').trim();
  }
  return trimmed;
}

export function normaliseTemplateInput(input: unknown): { id?: string; label: string; values: TemplateValues } {
  const parsed = templateUpsertSchema.parse(input);
  const values: TemplateValues = {};
  for (const field of parsed.fields) {
    const key = field.key;
    const normalised = normaliseValue(key, field.value);
    if (!normalised) continue;
    values[key] = normalised;
  }
  if (Object.keys(values).length === 0) {
    throw new Error('Add at least one populated field');
  }
  return {
    id: parsed.id,
    label: parsed.label.trim(),
    values
  };
}

function isMode(value: unknown): value is Mode {
  return value === 'offline' || value === 'semantic';
}

export function normaliseOverridePattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed) return '';
  if (trimmed === '*') return '*';
  if (!trimmed.includes('://') && trimmed.startsWith('*.')) {
    return trimmed.toLowerCase();
  }
  const hasPathWildcard = trimmed.endsWith('/*');
  const withoutPath = hasPathWildcard ? trimmed.slice(0, -2) : trimmed;
  const candidate = withoutPath.includes('://') ? withoutPath : `https://${withoutPath}`;
  try {
    const url = new URL(candidate);
    const origin = url.origin.toLowerCase();
    return hasPathWildcard ? `${origin}/*` : origin;
  } catch {
    return trimmed.toLowerCase();
  }
}

export function normaliseOverrides(
  overrides: Array<Partial<SiteOverride>> | undefined | null
): SiteOverride[] {
  if (!Array.isArray(overrides)) return [];
  const acc: SiteOverride[] = [];
  const seen = new Set<string>();
  for (const item of overrides) {
    const pattern = normaliseOverridePattern((item?.pattern as string | undefined) ?? '');
    if (!pattern) continue;
    const mode: Mode = isMode(item?.mode) ? (item?.mode as Mode) : 'offline';
    if (seen.has(pattern)) {
      const index = acc.findIndex((entry) => entry.pattern === pattern);
      if (index >= 0) {
        acc[index] = { pattern, mode };
      }
      continue;
    }
    seen.add(pattern);
    acc.push({ pattern, mode });
  }
  return acc.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

export function normaliseRuntimeSettings(input: unknown): RuntimeSettings {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_RUNTIME_SETTINGS };
  }
  const candidate = input as Partial<RuntimeSettings & { overrides: unknown; semanticEndpoint: unknown }>;
  const mode: Mode = isMode(candidate.mode) ? candidate.mode : 'offline';
  const semanticEndpoint = typeof candidate.semanticEndpoint === 'string' ? candidate.semanticEndpoint.trim() : '';
  const overridesInput = Array.isArray(candidate.overrides)
    ? (candidate.overrides as Array<Partial<SiteOverride>>)
    : [];
  const overrides = normaliseOverrides(overridesInput);
  return {
    mode,
    semanticEndpoint,
    overrides
  };
}

export function mergeRuntimeSettings(
  current: RuntimeSettings,
  update: Partial<{ mode: Mode; overrides: Array<Partial<SiteOverride>>; semanticEndpoint: string }>
): RuntimeSettings {
  const mode = isMode(update.mode) ? update.mode : current.mode;
  const endpointRaw = typeof update.semanticEndpoint === 'string' ? update.semanticEndpoint : current.semanticEndpoint;
  const semanticEndpoint = endpointRaw?.trim() ?? '';
  const overrides = update.overrides ? normaliseOverrides(update.overrides) : current.overrides;
  return {
    mode,
    semanticEndpoint,
    overrides
  };
}

export function matchesOverride(pattern: string, origin: string): boolean {
  if (!pattern) return false;
  if (pattern === '*') return true;
  const originLower = origin.toLowerCase();
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    try {
      const url = new URL(originLower);
      return url.hostname === suffix || url.hostname.endsWith(`.${suffix}`);
    } catch {
      return false;
    }
  }
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return originLower.startsWith(prefix);
  }
  return originLower === pattern;
}

export function effectiveMode(settings: RuntimeSettings, origin: string | undefined | null): Mode {
  if (!origin) return settings.mode;
  for (const override of settings.overrides) {
    if (matchesOverride(override.pattern, origin)) {
      return override.mode;
    }
  }
  return settings.mode;
}
