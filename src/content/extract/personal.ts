import type { Mode } from '../../core/model/schemas';
import { normalizeEmail, normalizePhone } from '../../lib/normalize';
import { logSemanticPrivacyNoticeOnce } from '../../lib/semantic';
import {
  scanVisibleTextNodes,
  describeElementPath,
  type TextSegment
} from '../dom/textScanner';

export type PersonalFieldKey =
  | 'identity.full_name'
  | 'identity.first_name'
  | 'identity.last_name'
  | 'contact.email'
  | 'contact.phone'
  | 'organization.name'
  | 'organization.title'
  | 'address.line1'
  | 'address.line2'
  | 'address.city'
  | 'address.region'
  | 'address.postal_code'
  | 'address.country';

export const PERSONAL_FIELD_DEFINITIONS: Array<{ key: PersonalFieldKey; label: string }> = [
  { key: 'identity.full_name', label: 'Full name' },
  { key: 'identity.first_name', label: 'First name' },
  { key: 'identity.last_name', label: 'Last name' },
  { key: 'contact.email', label: 'Email' },
  { key: 'contact.phone', label: 'Phone' },
  { key: 'organization.name', label: 'Organization' },
  { key: 'organization.title', label: 'Title' },
  { key: 'address.line1', label: 'Address line 1' },
  { key: 'address.line2', label: 'Address line 2' },
  { key: 'address.city', label: 'City' },
  { key: 'address.region', label: 'Region / State' },
  { key: 'address.postal_code', label: 'Postal code' },
  { key: 'address.country', label: 'Country' }
];

export interface PersonalExtractionOptions {
  mode?: Mode;
  semantic?: {
    endpoint?: string;
    apiKey?: string;
    timeoutMs?: number;
    active?: boolean;
  };
}

export type CandidateMethod = 'heuristic' | 'structural' | 'semantic' | 'derived';

export interface PersonalFieldCandidate {
  value: string;
  source: string;
  score: number;
  confidence: 'low' | 'medium' | 'high';
  method: CandidateMethod;
  path?: string;
}

export interface PersonalExtractionResult {
  fields: Partial<Record<PersonalFieldKey, PersonalFieldCandidate>>;
  candidates: Record<PersonalFieldKey, PersonalFieldCandidate[]>;
  usedSemantic: boolean;
  segmentsConsidered: number;
}

interface CandidateRecord {
  value: string;
  score: number;
  source: string;
  method: CandidateMethod;
  path?: string;
  element?: Element;
}

interface LabelValuePair {
  label: string;
  value: string;
  weight: number;
  element: Element;
  path: string;
}

interface SemanticEntityResult {
  type: string;
  text: string;
  value?: string;
  confidence?: number;
}

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /(\+?\d[\d\s().-]{6,}\d)/g;
const GENERIC_POSTAL_REGEX = /([A-Z]\d[A-Z][ -]?\d[A-Z]\d|\d{5}(?:-\d{4})?|\d{3,4}\s?\d{3,4})/i;
const TITLE_KEYWORDS = [
  'chief',
  'ceo',
  'cto',
  'cfo',
  'coo',
  'vp',
  'vice president',
  'director',
  'manager',
  'lead',
  'engineer',
  'developer',
  'founder',
  'co-founder',
  'president',
  'chairman',
  'chairwoman',
  'professor',
  'doctor',
  'designer',
  'consultant',
  'specialist'
];

const ORG_INDICATORS = [
  'inc',
  'inc.',
  'corp',
  'corp.',
  'corporation',
  'company',
  'co.',
  'co',
  'llc',
  'ltd',
  'limited',
  'gmbh',
  'oy',
  'sa',
  'srl',
  'ag',
  'nv',
  'university',
  'college',
  'school',
  'studio',
  'agency',
  'group'
];

const COUNTRY_NAMES = new Set<string>([
  'united states',
  'usa',
  'canada',
  'mexico',
  'united kingdom',
  'uk',
  'germany',
  'france',
  'spain',
  'italy',
  'australia',
  'new zealand',
  'india',
  'japan',
  'china',
  'singapore',
  'brazil',
  'argentina',
  'ireland',
  'sweden',
  'norway',
  'finland',
  'denmark',
  'switzerland',
  'netherlands'
]);

const PERSONAL_FIELD_SET = new Set<PersonalFieldKey>(PERSONAL_FIELD_DEFINITIONS.map((def) => def.key));
const NAME_PREFIXES = ['mr', 'mrs', 'ms', 'dr', 'prof', 'sir', 'madam'];

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 1.2) return 1;
  return Math.max(0, Math.min(1, score));
}

function scoreToConfidence(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function linesFromText(text: string): string[] {
  return text
    .split(/\n|\r|•|\||·/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function looksLikeName(value: string): boolean {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return false;
  if (cleaned.length > 64 || cleaned.length < 3) return false;
  if (/[@\d]/.test(cleaned)) return false;
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  let validWords = 0;
  for (const word of words) {
    const lower = word.toLowerCase().replace(/\.$/, '');
    if (NAME_PREFIXES.includes(lower)) continue;
    if (!/^[A-Z][a-zA-Z'.-]{1,}$/.test(word)) return false;
    validWords += 1;
  }
  return validWords >= 1;
}

function looksLikeOrganization(value: string): boolean {
  const cleaned = value.trim();
  if (!cleaned) return false;
  if (cleaned.length < 3 || cleaned.length > 80) return false;
  if (/^https?:\/\//i.test(cleaned)) return false;
  if (cleaned.includes('@')) return false;
  const lower = cleaned.toLowerCase();
  if (ORG_INDICATORS.some((indicator) => lower.includes(indicator))) return true;
  return cleaned.split(' ').filter(Boolean).length >= 1;
}

function looksLikeTitle(value: string): boolean {
  const cleaned = value.trim();
  if (!cleaned) return false;
  if (cleaned.length > 80) return false;
  const lower = cleaned.toLowerCase();
  if (TITLE_KEYWORDS.some((keyword) => lower.includes(keyword))) return true;
  if (lower.split(' ').length <= 6 && /manager|lead|director|officer|engineer|designer|founder|partner/.test(lower)) {
    return true;
  }
  return false;
}

function recordCandidate(map: Map<PersonalFieldKey, CandidateRecord[]>, key: PersonalFieldKey, candidate: CandidateRecord): void {
  if (!candidate.value) return;
  const value = candidate.value.trim();
  if (!value) return;
  const list = map.get(key) ?? [];
  const index = list.findIndex((entry) => entry.value.toLowerCase() === value.toLowerCase());
  if (index >= 0) {
    if (candidate.score > list[index].score) {
      list[index] = { ...candidate, value };
    }
  } else {
    list.push({ ...candidate, value });
  }
  map.set(key, list);
}

function addEmailCandidate(
  map: Map<PersonalFieldKey, CandidateRecord[]>,
  value: string,
  score: number,
  source: string,
  method: CandidateMethod,
  element?: Element
): void {
  const normalised = normalizeEmail(value);
  if (!normalised) return;
  recordCandidate(map, 'contact.email', {
    value: normalised,
    score: clampScore(score),
    source,
    method,
    element,
    path: element ? describeElementPath(element) : undefined
  });
}

function addPhoneCandidate(
  map: Map<PersonalFieldKey, CandidateRecord[]>,
  value: string,
  score: number,
  source: string,
  method: CandidateMethod,
  element?: Element
): void {
  const normalised = normalizePhone(value);
  if (!normalised) return;
  if (normalised.replace(/\D/g, '').length < 7) return;
  recordCandidate(map, 'contact.phone', {
    value: normalised,
    score: clampScore(score),
    source,
    method,
    element,
    path: element ? describeElementPath(element) : undefined
  });
}

function addAddressComponents(
  map: Map<PersonalFieldKey, CandidateRecord[]>,
  parts: Partial<Record<'line1' | 'line2' | 'city' | 'region' | 'postal_code' | 'country', string>>,
  baseScore: number,
  source: string,
  method: CandidateMethod,
  element?: Element
): void {
  const score = clampScore(baseScore);
  const path = element ? describeElementPath(element) : undefined;
  const scoreRecord = (value: string, key: PersonalFieldKey) => {
    recordCandidate(map, key, {
      value,
      score,
      source,
      method,
      element,
      path
    });
  };
  if (parts.line1) scoreRecord(parts.line1, 'address.line1');
  if (parts.line2) scoreRecord(parts.line2, 'address.line2');
  if (parts.city) scoreRecord(parts.city, 'address.city');
  if (parts.region) scoreRecord(parts.region, 'address.region');
  if (parts.postal_code) scoreRecord(parts.postal_code, 'address.postal_code');
  if (parts.country) scoreRecord(parts.country, 'address.country');
}

function parseAddressComponents(raw: string): Partial<Record<'line1' | 'line2' | 'city' | 'region' | 'postal_code' | 'country', string>> {
  const cleaned = raw
    .replace(/\s{2,}/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
  if (!cleaned) return {};
  const lines = cleaned
    .split(/\n|\r|;/)
    .map((line) => line.split(/\s{2,}/).join(' '))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!lines.length) return {};
  const working = [...lines];
  const result: Partial<Record<'line1' | 'line2' | 'city' | 'region' | 'postal_code' | 'country', string>> = {};

  const maybeCountry = working[working.length - 1];
  if (maybeCountry && COUNTRY_NAMES.has(maybeCountry.toLowerCase())) {
    result.country = maybeCountry;
    working.pop();
  }

  if (working.length) {
    const lastLine = working[working.length - 1];
    const postalMatch = lastLine.match(GENERIC_POSTAL_REGEX);
    if (postalMatch) {
      result.postal_code = postalMatch[0].toUpperCase();
      working[working.length - 1] = lastLine.replace(postalMatch[0], '').replace(/\s{2,}/g, ' ').trim().replace(/[,\s]+$/, '');
    }
  }

  if (working.length) {
    const trailing = working[working.length - 1];
    if (trailing) {
      const parts = trailing.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        if (!result.city) result.city = parts[0];
        if (!result.region) result.region = parts[1];
        if (!result.postal_code) result.postal_code = parts[2];
      } else if (parts.length === 2) {
        if (!result.city) result.city = parts[0];
        if (!result.region) result.region = parts[1];
      } else {
        const tokens = trailing.split(/\s+/);
        if (tokens.length >= 2) {
          if (!result.city) result.city = tokens.slice(0, tokens.length - 1).join(' ');
          if (!result.region) result.region = tokens[tokens.length - 1];
        } else if (!result.city) {
          result.city = trailing;
        }
      }
      working.pop();
    }
  }

  if (working.length) {
    result.line1 = working.shift();
  }
  if (working.length) {
    result.line2 = working.shift();
  }
  return result;
}

function collectLabelValuePairs(segments: TextSegment[], pathWeight: Map<string, number>): LabelValuePair[] {
  const pairs: LabelValuePair[] = [];
  const seenPairs = new Set<string>();

  for (const segment of segments) {
    const lines = linesFromText(segment.text);
    for (const line of lines) {
      if (!line.includes(':')) continue;
      if (line.length > 160) continue;
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const rawLabel = line.slice(0, idx);
      const rawValue = line.slice(idx + 1);
      if (!rawLabel || !rawValue) continue;
      const label = normalizeWhitespace(rawLabel);
      const value = normalizeWhitespace(rawValue);
      if (!label || !value) continue;
      const key = `${label.toLowerCase()}|${value.toLowerCase()}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      pairs.push({
        label,
        value,
        weight: segment.weight,
        element: segment.element,
        path: segment.path
      });
    }
  }

  const dlItems = document.querySelectorAll('dl');
  for (const dl of Array.from(dlItems)) {
    const dts = dl.querySelectorAll('dt');
    for (const dt of Array.from(dts)) {
      const dd = dt.nextElementSibling;
      if (!dd) continue;
      if (dd.tagName !== 'DD') continue;
      const label = normalizeWhitespace(dt.textContent || '');
      const value = normalizeWhitespace(dd.textContent || '');
      if (!label || !value) continue;
      const key = `${label.toLowerCase()}|${value.toLowerCase()}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const path = describeElementPath(dd);
      const weight = Math.max(pathWeight.get(path) ?? 0.6, 0.4);
      pairs.push({ label, value, weight, element: dd, path });
    }
  }

  const tableRows = document.querySelectorAll('table tr');
  for (const row of Array.from(tableRows)) {
    const headerCell = row.querySelector('th, td');
    if (!headerCell) continue;
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue;
    const label = normalizeWhitespace(headerCell.textContent || '');
    if (!label) continue;
    const value = normalizeWhitespace(cells[cells.length - 1].textContent || '');
    if (!value) continue;
    const key = `${label.toLowerCase()}|${value.toLowerCase()}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const path = describeElementPath(cells[cells.length - 1]);
    const weight = Math.max(pathWeight.get(path) ?? 0.5, 0.4);
    pairs.push({ label, value, weight, element: cells[cells.length - 1], path });
  }

  return pairs;
}

function labelToField(label: string): PersonalFieldKey | 'address' | null {
  const lower = label.toLowerCase();
  if (/(^|\b)(email|e-mail|mail)(\b|$)/.test(lower)) return 'contact.email';
  if (/(^|\b)(phone|telephone|tel|mobile|cell)(\b|$)/.test(lower)) return 'contact.phone';
  if (/(^|\b)(full name|name)(\b|$)/.test(lower)) return 'identity.full_name';
  if (/(^|\b)(first name|given name)(\b|$)/.test(lower)) return 'identity.first_name';
  if (/(^|\b)(last name|family name|surname)(\b|$)/.test(lower)) return 'identity.last_name';
  if (/(^|\b)(company|organization|organisation|employer|workplace|firm|agency|studio)(\b|$)/.test(lower)) return 'organization.name';
  if (/(^|\b)(title|position|role|job)(\b|$)/.test(lower)) return 'organization.title';
  if (/(^|\b)(address|location|office|hq)(\b|$)/.test(lower)) return 'address';
  if (/(^|\b)(street|address line 1|line 1|addr1)(\b|$)/.test(lower)) return 'address.line1';
  if (/(^|\b)(address line 2|line 2|addr2|suite|unit)(\b|$)/.test(lower)) return 'address.line2';
  if (/(^|\b)(city|town)(\b|$)/.test(lower)) return 'address.city';
  if (/(^|\b)(state|province|region|county)(\b|$)/.test(lower)) return 'address.region';
  if (/(^|\b)(postal code|postcode|zip|zip code)(\b|$)/.test(lower)) return 'address.postal_code';
  if (/(^|\b)(country|nation)(\b|$)/.test(lower)) return 'address.country';
  return null;
}

function collectEmails(map: Map<PersonalFieldKey, CandidateRecord[]>, segments: TextSegment[]): void {
  for (const segment of segments) {
    const matches = segment.text.matchAll(EMAIL_REGEX);
    for (const match of matches) {
      const value = match[0];
      addEmailCandidate(map, value, segment.weight + 0.2, `text:${segment.path}`, 'heuristic', segment.element);
    }
  }
  const mailto = document.querySelectorAll('a[href^="mailto:"]');
  for (const el of Array.from(mailto)) {
    const href = el.getAttribute('href') || '';
    const email = href.replace(/^mailto:/i, '').split('?')[0];
    if (!email) continue;
    addEmailCandidate(map, email, 1, 'mailto-link', 'structural', el);
  }
}

function collectPhones(map: Map<PersonalFieldKey, CandidateRecord[]>, segments: TextSegment[]): void {
  for (const segment of segments) {
    const matches = segment.text.matchAll(PHONE_REGEX);
    for (const match of matches) {
      const value = match[0];
      const digits = value.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) continue;
      addPhoneCandidate(map, value, segment.weight, `text:${segment.path}`, 'heuristic', segment.element);
    }
  }
  const telLinks = document.querySelectorAll('a[href^="tel:"]');
  for (const el of Array.from(telLinks)) {
    const href = el.getAttribute('href') || '';
    const phone = href.replace(/^tel:/i, '');
    addPhoneCandidate(map, phone, 0.95, 'tel-link', 'structural', el);
  }
}

function collectHeadings(map: Map<PersonalFieldKey, CandidateRecord[]>, pathWeight: Map<string, number>): void {
  const selectors = 'h1, h2, h3, [itemprop="name"], .profile-name, .full-name, .user-name, .author-name, .p-name, .fn';
  const elements = document.querySelectorAll(selectors);
  for (const el of Array.from(elements)) {
    const text = normalizeWhitespace(el.textContent || '');
    if (!text) continue;
    if (!looksLikeName(text)) continue;
    const path = describeElementPath(el);
    const baseScore = Math.max(pathWeight.get(path) ?? 0.7, 0.6);
    recordCandidate(map, 'identity.full_name', {
      value: text,
      score: clampScore(baseScore + 0.15),
      source: `heading:${path}`,
      method: 'heuristic',
      element: el,
      path
    });
  }
}

function collectOrganizationHints(map: Map<PersonalFieldKey, CandidateRecord[]>, pathWeight: Map<string, number>): void {
  const selectors = '[itemprop="worksFor"], [itemprop="affiliation"], .company, .company-name, .organization-name, .organisation-name, .employer, .workplace, .org-name';
  const elements = document.querySelectorAll(selectors);
  for (const el of Array.from(elements)) {
    const text = normalizeWhitespace(el.textContent || '');
    if (!text || text.length > 120) continue;
    if (!looksLikeOrganization(text)) continue;
    const path = describeElementPath(el);
    const weight = Math.max(pathWeight.get(path) ?? 0.6, 0.5);
    recordCandidate(map, 'organization.name', {
      value: text,
      score: clampScore(weight),
      source: `org:${path}`,
      method: 'heuristic',
      element: el,
      path
    });
  }
}

function collectTitleHints(map: Map<PersonalFieldKey, CandidateRecord[]>, pathWeight: Map<string, number>): void {
  const selectors = '[itemprop="jobTitle"], .job-title, .title, .position, .role';
  const elements = document.querySelectorAll(selectors);
  for (const el of Array.from(elements)) {
    const text = normalizeWhitespace(el.textContent || '');
    if (!text || text.length > 120) continue;
    if (!looksLikeTitle(text)) continue;
    const path = describeElementPath(el);
    const weight = Math.max(pathWeight.get(path) ?? 0.6, 0.5);
    recordCandidate(map, 'organization.title', {
      value: text,
      score: clampScore(weight),
      source: `title:${path}`,
      method: 'heuristic',
      element: el,
      path
    });
  }
}

function collectAddressElements(map: Map<PersonalFieldKey, CandidateRecord[]>, pathWeight: Map<string, number>): void {
  const addressElements = document.querySelectorAll('address, .address, .contact-address, [itemprop="address"]');
  for (const el of Array.from(addressElements)) {
    const text = normalizeWhitespace((el as HTMLElement).innerText || el.textContent || '');
    if (!text) continue;
    const components = parseAddressComponents(text);
    if (Object.keys(components).length === 0) continue;
    const path = describeElementPath(el);
    const weight = Math.max(pathWeight.get(path) ?? 0.65, 0.55);
    addAddressComponents(map, components, weight, `address:${path}`, 'heuristic', el);
  }
}

function applyLabelPairs(
  map: Map<PersonalFieldKey, CandidateRecord[]>,
  pairs: LabelValuePair[]
): void {
  for (const pair of pairs) {
    const field = labelToField(pair.label);
    if (!field) continue;
    const value = pair.value;
    const path = pair.path;
    if (field === 'contact.email') {
      if (value.includes('@')) {
        addEmailCandidate(map, value, pair.weight + 0.25, `label:${path}`, 'structural', pair.element);
      }
      continue;
    }
    if (field === 'contact.phone') {
      addPhoneCandidate(map, value, pair.weight + 0.1, `label:${path}`, 'structural', pair.element);
      continue;
    }
    if (field === 'identity.full_name') {
      if (!looksLikeName(value)) continue;
      recordCandidate(map, 'identity.full_name', {
        value,
        score: clampScore(pair.weight + 0.1),
        source: `label:${path}`,
        method: 'structural',
        element: pair.element,
        path
      });
      continue;
    }
    if (field === 'identity.first_name') {
      recordCandidate(map, 'identity.first_name', {
        value,
        score: clampScore(pair.weight),
        source: `label:${path}`,
        method: 'structural',
        element: pair.element,
        path
      });
      continue;
    }
    if (field === 'identity.last_name') {
      recordCandidate(map, 'identity.last_name', {
        value,
        score: clampScore(pair.weight),
        source: `label:${path}`,
        method: 'structural',
        element: pair.element,
        path
      });
      continue;
    }
    if (field === 'organization.name') {
      if (!looksLikeOrganization(value)) continue;
      recordCandidate(map, 'organization.name', {
        value,
        score: clampScore(pair.weight),
        source: `label:${path}`,
        method: 'structural',
        element: pair.element,
        path
      });
      continue;
    }
    if (field === 'organization.title') {
      if (!looksLikeTitle(value)) continue;
      recordCandidate(map, 'organization.title', {
        value,
        score: clampScore(pair.weight),
        source: `label:${path}`,
        method: 'structural',
        element: pair.element,
        path
      });
      continue;
    }
    if (field === 'address') {
      const components = parseAddressComponents(value);
      if (Object.keys(components).length === 0) continue;
      addAddressComponents(map, components, pair.weight, `label:${path}`, 'structural', pair.element);
      continue;
    }
    if (field.startsWith('address.')) {
      addAddressComponents(
        map,
        { [field.split('.')[1] as keyof ReturnType<typeof parseAddressComponents>]: value },
        pair.weight,
        `label:${path}`,
        'structural',
        pair.element
      );
    }
  }
}

function deriveNamePieces(map: Map<PersonalFieldKey, CandidateRecord[]>): void {
  const full = map.get('identity.full_name');
  if (full && full.length) {
    const best = full[0];
    const parts = best.value.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      if (!map.get('identity.first_name')?.length && first) {
        recordCandidate(map, 'identity.first_name', {
          value: first,
          score: clampScore(best.score - 0.1),
          source: 'derived-from-full-name',
          method: 'derived',
          element: best.element,
          path: best.path
        });
      }
      if (!map.get('identity.last_name')?.length && last) {
        recordCandidate(map, 'identity.last_name', {
          value: last,
          score: clampScore(best.score - 0.1),
          source: 'derived-from-full-name',
          method: 'derived',
          element: best.element,
          path: best.path
        });
      }
    }
  }
  const firstList = map.get('identity.first_name');
  const lastList = map.get('identity.last_name');
  if ((!full || !full.length) && firstList && firstList.length && lastList && lastList.length) {
    const combined = `${firstList[0].value} ${lastList[0].value}`;
    recordCandidate(map, 'identity.full_name', {
      value: combined,
      score: clampScore((firstList[0].score + lastList[0].score) / 2),
      source: 'derived-from-first-last',
      method: 'derived',
      element: firstList[0].element ?? lastList[0].element,
      path: firstList[0].path ?? lastList[0].path
    });
  }
}

async function runSemanticEntities(
  segments: TextSegment[],
  options: PersonalExtractionOptions['semantic']
): Promise<SemanticEntityResult[]> {
  if (!options?.endpoint) return [];
  const topSegments = segments.slice(0, 24);
  if (!topSegments.length) return [];
  logSemanticPrivacyNoticeOnce({ enabled: true, apiUrl: options.endpoint });
  const payloadText = topSegments
    .map((segment) => segment.text)
    .join('\n')
    .slice(0, 2400);
  if (!payloadText) return [];
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 3500);
  try {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
      },
      body: JSON.stringify({
        text: payloadText,
        types: ['PERSON', 'ORG', 'TITLE', 'EMAIL', 'PHONE', 'LOCATION']
      }),
      signal: controller.signal
    });
    if (!response.ok) return [];
    const data = (await response.json()) as unknown;
    const entities: SemanticEntityResult[] = [];
    if (Array.isArray((data as { entities?: unknown }).entities)) {
      for (const item of (data as { entities: unknown[] }).entities) {
        const entity = item as SemanticEntityResult;
        if (entity && typeof entity.type === 'string' && typeof entity.text === 'string') {
          entities.push(entity);
        }
      }
      return entities;
    }
    if (Array.isArray(data)) {
      for (const item of data as SemanticEntityResult[]) {
        if (item && typeof item.type === 'string' && typeof item.text === 'string') {
          entities.push(item);
        }
      }
      return entities;
    }
    return [];
  } catch (error) {
    console.warn('[AIAutoFill] semantic entity extraction failed', error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function integrateSemanticEntities(
  map: Map<PersonalFieldKey, CandidateRecord[]>,
  entities: SemanticEntityResult[]
): void {
  for (const entity of entities) {
    const score = clampScore((entity.confidence ?? 0.6) + 0.2);
    const source = 'semantic';
    const text = normalizeWhitespace(entity.value || entity.text || '');
    if (!text) continue;
    switch (entity.type?.toUpperCase()) {
      case 'PERSON':
        if (looksLikeName(text)) {
          recordCandidate(map, 'identity.full_name', {
            value: text,
            score,
            source,
            method: 'semantic'
          });
        }
        break;
      case 'EMAIL':
        addEmailCandidate(map, text, score, source, 'semantic');
        break;
      case 'PHONE':
        addPhoneCandidate(map, text, score, source, 'semantic');
        break;
      case 'ORG':
      case 'ORGANIZATION':
        if (looksLikeOrganization(text)) {
          recordCandidate(map, 'organization.name', {
            value: text,
            score,
            source,
            method: 'semantic'
          });
        }
        break;
      case 'TITLE':
        if (looksLikeTitle(text)) {
          recordCandidate(map, 'organization.title', {
            value: text,
            score,
            source,
            method: 'semantic'
          });
        }
        break;
      case 'LOCATION': {
        const components = parseAddressComponents(text);
        if (Object.keys(components).length) {
          addAddressComponents(map, components, score, source, 'semantic');
        }
        break;
      }
      default:
        break;
    }
  }
}

function sanitizeCandidates(map: Map<PersonalFieldKey, CandidateRecord[]>): Record<PersonalFieldKey, PersonalFieldCandidate[]> {
  const result: Record<PersonalFieldKey, PersonalFieldCandidate[]> = {} as Record<PersonalFieldKey, PersonalFieldCandidate[]>;
  for (const [key, list] of map.entries()) {
    if (!PERSONAL_FIELD_SET.has(key)) continue;
    const sorted = [...list].sort((a, b) => b.score - a.score);
    result[key] = sorted.map((item) => ({
      value: item.value,
      source: item.source,
      score: clampScore(item.score),
      confidence: scoreToConfidence(item.score),
      method: item.method,
      path: item.path
    }));
  }
  return result;
}

function pickBestFields(candidateMap: Map<PersonalFieldKey, CandidateRecord[]>): Partial<Record<PersonalFieldKey, PersonalFieldCandidate>> {
  const out: Partial<Record<PersonalFieldKey, PersonalFieldCandidate>> = {};
  for (const def of PERSONAL_FIELD_DEFINITIONS) {
    const list = candidateMap.get(def.key);
    if (!list || list.length === 0) continue;
    const best = [...list].sort((a, b) => b.score - a.score)[0];
    out[def.key] = {
      value: best.value,
      source: best.source,
      score: clampScore(best.score),
      confidence: scoreToConfidence(best.score),
      method: best.method,
      path: best.path
    };
  }
  return out;
}

export async function extractPersonalInformation(
  options?: PersonalExtractionOptions
): Promise<PersonalExtractionResult> {
  const segments = scanVisibleTextNodes({ maxNodes: 750, minChars: 3 });
  const candidateMap = new Map<PersonalFieldKey, CandidateRecord[]>();
  const pathWeight = new Map<string, number>();
  for (const segment of segments) {
    const current = pathWeight.get(segment.path) ?? 0;
    if (segment.weight > current) {
      pathWeight.set(segment.path, segment.weight);
    }
  }

  collectEmails(candidateMap, segments);
  collectPhones(candidateMap, segments);
  collectHeadings(candidateMap, pathWeight);
  collectOrganizationHints(candidateMap, pathWeight);
  collectTitleHints(candidateMap, pathWeight);
  collectAddressElements(candidateMap, pathWeight);

  const pairs = collectLabelValuePairs(segments, pathWeight);
  applyLabelPairs(candidateMap, pairs);

  deriveNamePieces(candidateMap);

  let usedSemantic = false;
  if ((options?.mode === 'semantic' || options?.semantic?.active) && options?.semantic?.endpoint) {
    const entities = await runSemanticEntities(segments, options.semantic);
    if (entities.length) {
      usedSemantic = true;
      integrateSemanticEntities(candidateMap, entities);
      deriveNamePieces(candidateMap);
    }
  }

  const candidates = sanitizeCandidates(candidateMap);
  for (const def of PERSONAL_FIELD_DEFINITIONS) {
    if (!(def.key in candidates)) {
      candidates[def.key] = [];
    }
  }
  const fields = pickBestFields(candidateMap);

  return {
    fields,
    candidates,
    usedSemantic,
    segmentsConsidered: segments.length
  };
}
