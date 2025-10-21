// Normalization utilities for email, URL, and phone numbers

export interface NormalizeEmailOptions {
  trim?: boolean;
  lowerCase?: boolean; // default true
  removeMailto?: boolean; // default true
}

export function normalizeEmail(input: string, opts?: NormalizeEmailOptions): string {
  const options: Required<NormalizeEmailOptions> = {
    trim: true,
    lowerCase: true,
    removeMailto: true,
    ...(opts || {})
  } as Required<NormalizeEmailOptions>;

  let s = input || '';
  if (options.removeMailto) s = s.replace(/^mailto:/i, '');
  if (options.trim) s = s.trim();
  // remove zero-width and whitespace
  s = s.replace(/[\u200B-\u200D\uFEFF\s]+/g, '');
  // unicode NFKC normalization
  try {
    s = s.normalize('NFKC');
  } catch {
    // ignore if not supported
  }
  if (options.lowerCase) s = s.toLowerCase();
  return s;
}

export interface NormalizeUrlOptions {
  defaultProtocol?: 'https:' | 'http:';
  stripWWW?: boolean; // default false
  removeTrailingSlash?: boolean; // default true
  stripHash?: boolean; // default true
  stripUTM?: boolean; // default true
}

export function normalizeUrl(input: string, opts?: NormalizeUrlOptions): string {
  const options: Required<NormalizeUrlOptions> = {
    defaultProtocol: 'https:',
    stripWWW: false,
    removeTrailingSlash: true,
    stripHash: true,
    stripUTM: true,
    ...(opts || {})
  } as Required<NormalizeUrlOptions>;

  let i = (input || '').trim();
  if (!i) return '';
  // add protocol if missing
  if (!/^([a-z]+:)?\/\//i.test(i)) i = `${options.defaultProtocol}//${i}`;
  let u: URL;
  try {
    u = new URL(i);
  } catch {
    return i; // return as-is if cannot parse
  }
  if (options.stripHash) u.hash = '';
  if (options.stripUTM) {
    const params = u.searchParams;
    const toDelete: string[] = [];
    params.forEach((_v, k) => {
      if (/^utm_/i.test(k) || /^(ref|source)$/i.test(k)) toDelete.push(k);
    });
    for (const k of toDelete) params.delete(k);
    // keep params sorted for stability
    const entries = Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    u.search = entries.length ? `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
  }
  u.hostname = u.hostname.toLowerCase();
  if (options.stripWWW && u.hostname.startsWith('www.')) {
    u.hostname = u.hostname.slice(4);
  }
  // remove default ports
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }
  // construct string
  let out = u.toString();
  if (options.removeTrailingSlash) out = out.replace(/(?<!:)\/$/, '');
  return out;
}

export interface NormalizePhoneOptions {
  defaultCountry?: string; // ISO 3166-1 alpha-2 (e.g., 'US')
}

// Minimal country calling codes for common countries (not exhaustive)
const COUNTRY_CODE: Record<string, string> = {
  US: '1',
  CA: '1',
  GB: '44',
  DE: '49',
  FR: '33',
  ES: '34',
  IT: '39',
  AU: '61',
  NZ: '64',
  IN: '91',
  BR: '55',
  MX: '52',
  JP: '81',
  KR: '82',
  CN: '86'
};

export function normalizePhone(input: string, opts?: NormalizePhoneOptions): string {
  let s = (input || '').trim();
  if (!s) return '';
  // Convert 00 international prefix to +
  s = s.replace(/^00/, '+');
  // Keep plus and digits only
  s = s.replace(/[^+\d]/g, '');
  // If starts with + it's already international
  if (s.startsWith('+')) return s;
  const cc = COUNTRY_CODE[(opts?.defaultCountry || '').toUpperCase()] || '';
  if (cc) return `+${cc}${s}`;
  // Unknown country, return digits (no plus)
  return s;
}

export function normalizeByFieldPath(path: string, value: unknown, options?: { defaultCountry?: string }): unknown {
  const v = typeof value === 'string' ? value : String(value ?? '');
  const p = path.toLowerCase();
  if (/email/.test(p)) return normalizeEmail(v);
  if (/url|website|profile|avatar|image|rss|linkedin|github|twitter|facebook|instagram|youtube|tiktok/.test(p)) return normalizeUrl(v);
  if (/phone|tel|fax/.test(p)) return normalizePhone(v, { defaultCountry: options?.defaultCountry });
  return v.trim();
}
