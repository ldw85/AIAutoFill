import type { Candidate } from '../content/domScanner';
import {
  DEFAULT_MATCHER_CONFIG,
  type MatcherConfig,
  type OntologyKey
} from './ontology';

export interface HeuristicContribution {
  id: 'autocomplete' | 'alias' | 'type' | 'regex' | 'schema' | 'fuzzy';
  score: number; // 0..1
  weight: number; // weight applied
  weightedScore: number; // score * weight
  evidence: Record<string, unknown>;
}

export interface MatchExplanation {
  totalScore: number; // 0..1 after combining weighted contributions and clamping to 1
  contributions: HeuristicContribution[];
  highlights?: Highlight[]; // elements to highlight in UI
}

export interface Highlight {
  source: 'id' | 'name' | 'class' | 'label' | 'placeholder' | 'aria-label' | 'title' | 'autocomplete';
  value: string;
  matched: string[]; // matched tokens or substrings
}

export interface MatchResult {
  key: OntologyKey;
  candidate: Candidate;
  score: number; // 0..1
  rank: number; // 1-based after sorting
  explanation: MatchExplanation;
  tier: 'accept' | 'consider' | 'reject';
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(str: string): string[] {
  const n = normalize(str);
  if (!n) return [];
  return n.split(/[^a-z0-9]+/g).filter(Boolean);
}

function bigrams(str: string): string[] {
  const n = normalize(str).replace(/\s+/g, '');
  if (n.length < 2) return [n];
  const out: string[] = [];
  for (let i = 0; i < n.length - 1; i++) out.push(n.slice(i, i + 2));
  return out;
}

function diceCoefficient(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) || 0) + 1);
  let inter = 0;
  for (const g of B) {
    const c = counts.get(g) || 0;
    if (c > 0) {
      inter++;
      counts.set(g, c - 1);
    }
  }
  return (2 * inter) / (A.length + B.length);
}

function jaccardTokens(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}

function bestFuzzy(a: string, b: string): { score: number; method: string } {
  const d = diceCoefficient(a, b);
  const j = jaccardTokens(a, b);
  const contains = normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a));
  const cScore = contains ? Math.max(d, j, 0.92) : Math.max(d, j);
  const score = Math.max(cScore, 0);
  const method = contains ? 'contains+dice/jaccard' : d >= j ? 'dice' : 'jaccard';
  return { score, method };
}

function truthyStrings(values: Array<string | null | undefined>): string[] {
  return values.map((v) => (v ?? '').toString().trim()).filter((v) => v.length > 0);
}

function collectFieldTexts(c: Candidate): { bucket: Record<string, string>; all: string[] } {
  const bucket: Record<string, string> = {};
  const attrs = c.attributes || {};
  if (attrs.id) bucket.id = String(attrs.id);
  if (attrs.name) bucket.name = String(attrs.name);
  if (attrs.placeholder) bucket.placeholder = String(attrs.placeholder);
  if (attrs['aria-label']) bucket['aria-label'] = String(attrs['aria-label']);
  if (attrs.title) bucket.title = String(attrs.title);
  if (attrs.autocomplete) bucket.autocomplete = String(attrs.autocomplete);
  if (c.accessibleName?.value) bucket.label = String(c.accessibleName.value);
  const classes = (c.classes || []).join(' ');
  if (classes) bucket.class = classes;

  const all = Object.values(bucket);
  return { bucket, all };
}

function ensureRegExp(re: string | RegExp): RegExp {
  return typeof re === 'string' ? new RegExp(re, 'i') : re;
}



function pickTier(score: number, config: MatcherConfig): 'accept' | 'consider' | 'reject' {
  if (score >= config.thresholds.accept) return 'accept';
  if (score >= config.thresholds.consider) return 'consider';
  return 'reject';
}

function aliasMatchScore(key: OntologyKey, texts: string[]): { score: number; matched: string[] } {
  const aliases = new Set<string>([
    key.key,
    ...(key.label ? [key.label] : []),
    ...(key.aliases || [])
  ].map((s) => normalize(s)));
  const matched: string[] = [];
  let best = 0;
  for (const t of texts) {
    const n = normalize(t);
    if (!n) continue;
    if (aliases.has(n)) {
      matched.push(t);
      best = Math.max(best, 1);
      continue;
    }
    // allow hyphen/space differences
    const n2 = n.replace(/[-_\s]+/g, ' ');
    for (const a of aliases) {
      const a2 = a.replace(/[-_\s]+/g, ' ');
      if (a2 === n2) {
        matched.push(t);
        best = Math.max(best, 0.98);
      }
    }
  }
  return { score: best, matched };
}

function schemaHintScore(key: OntologyKey, texts: string[], synonyms: Record<string, string[]> | undefined): { score: number; matched: string[] } {
  const syns = new Set<string>([
    key.key,
    ...(key.aliases || []),
    ...((synonyms?.[key.key] as string[] | undefined) || [])
  ].map((s) => normalize(s)));
  const matched: string[] = [];
  let best = 0;
  for (const t of texts) {
    const tokens = tokenize(t);
    for (const token of tokens) {
      if (syns.has(token)) {
        matched.push(t);
        best = Math.max(best, 1);
      }
    }
  }
  return { score: Math.min(best, 1), matched };
}

function typeConstraintScore(key: OntologyKey, candidate: Candidate): { score: number; evidence: Record<string, unknown> } {
  const typeStr = candidate.type || candidate.attributes?.type || null;
  const role = candidate.role || candidate.attributes?.role || null;
  const inputType = (typeStr || '').toLowerCase();
  const keyType = key.type || 'text';

  let score = 0;
  const evidence: Record<string, unknown> = { inputType, role, keyType };

  if (!inputType && !role) return { score, evidence };

  const typeMatches: Record<string, string[]> = {
    email: ['email'],
    phone: ['tel', 'phone'],
    date: ['date'],
    number: ['number']
  };

  const expected = typeMatches[keyType];
  if (expected && expected.includes(inputType)) {
    score = 1;
  } else if (keyType === 'text') {
    score = 0.2; // text fields are permissive
  } else if (inputType === 'text' || inputType === '') {
    score = 0.2; // generic text input can still be used
  }
  return { score, evidence };
}

function regexConstraintScore(key: OntologyKey, candidate: Candidate): { score: number; evidence: Record<string, unknown> } {
  const pattern = candidate.attributes?.pattern || null;
  const valueHints = truthyStrings([
    candidate.attributes?.placeholder || undefined,
    candidate.accessibleName?.value || undefined,
    candidate.attributes?.title || undefined
  ]);

  if (!key.regexes || key.regexes.length === 0) return { score: 0, evidence: {} };

  let score = 0;
  const matchedSources: string[] = [];

  // If candidate has pattern and it matches at least one of expected regexes, boost strongly
  if (pattern) {
    try {
      const userRe = new RegExp(pattern);
      for (const r of key.regexes) {
        const re = ensureRegExp(r);
        // Heuristic: check some representative strings
        const samples = ['abc', '123', 'test@example.com', '555-1234'];
        const reStr = re.toString();
        const userStr = userRe.toString();
        if (reStr === userStr) {
          score = Math.max(score, 1);
        } else {
          for (const s of samples) {
            if (re.test(s) === userRe.test(s)) {
              score = Math.max(score, 0.6);
            }
          }
        }
      }
    } catch {
      // ignore malformed pattern
    }
  }

  // Also inspect visible hints for matching expected regexes
  for (const r of key.regexes) {
    const re = ensureRegExp(r);
    for (const src of valueHints) {
      if (re.test(src)) {
        score = Math.max(score, 0.7);
        matchedSources.push(src);
      }
    }
  }

  return { score, evidence: { matchedSources, pattern } };
}

function autocompleteScore(key: OntologyKey, candidate: Candidate, autocompleteMap: Record<string, string> | undefined) {
  const ac = (candidate.attributes?.autocomplete || '').toLowerCase().trim();
  if (!ac) return { score: 0, evidence: {} };
  const mapped = autocompleteMap?.[ac] || ac;
  const hit = normalize(mapped) === normalize(key.key) || (key.aliases || []).map(normalize).includes(normalize(mapped));
  return { score: hit ? 1 : 0, evidence: { autocomplete: ac, mapped } };
}

function fuzzyScore(key: OntologyKey, texts: string[]): { score: number; evidence: Record<string, unknown>; highlights: Highlight[] } {
  let best = 0;
  let bestPair: { a: string; b: string; method: string; score: number } | null = null;
  const highlights: Highlight[] = [];
  const targets = [key.key, ...(key.label ? [key.label] : []), ...(key.aliases || [])];
  const fields: Array<{ source: Highlight['source']; value: string }> = [];

  for (const t of texts) {
    fields.push({ source: 'label', value: t });
  }

  for (const f of fields) {
    for (const target of targets) {
      const r = bestFuzzy(f.value, target);
      if (r.score > best) {
        best = r.score;
        bestPair = { a: f.value, b: target, method: r.method, score: r.score };
      }
    }
  }

  if (bestPair) {
    const matchedTokens: string[] = [];
    const aTokens = tokenize(bestPair.a);
    const bTokens = tokenize(bestPair.b);
    for (const t of aTokens) if (bTokens.includes(t)) matchedTokens.push(t);
    highlights.push({ source: 'label', value: bestPair.a, matched: matchedTokens });
  }

  return { score: best, evidence: bestPair || {}, highlights };
}

export function rankCandidatesForKey(
  key: OntologyKey,
  candidates: Candidate[],
  cfg?: Partial<MatcherConfig>
): MatchResult[] {
  const config: MatcherConfig = { ...DEFAULT_MATCHER_CONFIG, ...cfg, thresholds: { ...DEFAULT_MATCHER_CONFIG.thresholds, ...(cfg?.thresholds || {}) }, weights: { ...DEFAULT_MATCHER_CONFIG.weights, ...(cfg?.weights || {}) } };

  const results: MatchResult[] = [];
  for (const cand of candidates) {
    const { bucket } = collectFieldTexts(cand);

    const contr: HeuristicContribution[] = [];

    // 1) deterministic: autocomplete
    {
      const r = autocompleteScore(key, cand, config.autocompleteMap);
      const weightedScore = r.score * config.weights.deterministicAutocomplete;
      contr.push({ id: 'autocomplete', score: r.score, weight: config.weights.deterministicAutocomplete, weightedScore, evidence: r.evidence });
    }

    // 2) deterministic: alias/id/name exact match
    {
      const texts = truthyStrings([bucket.id, bucket.name, bucket.class, bucket.label, bucket.placeholder, bucket['aria-label'], bucket.title]);
      const r = aliasMatchScore(key, texts);
      const weightedScore = r.score * config.weights.deterministicAlias;
      contr.push({ id: 'alias', score: r.score, weight: config.weights.deterministicAlias, weightedScore, evidence: { matched: r.matched } });
    }

    // 3) type constraint
    {
      const r = typeConstraintScore(key, cand);
      const weightedScore = r.score * config.weights.typeConstraint;
      contr.push({ id: 'type', score: r.score, weight: config.weights.typeConstraint, weightedScore, evidence: r.evidence });
    }

    // 4) regex constraint
    {
      const r = regexConstraintScore(key, cand);
      const weightedScore = r.score * config.weights.regexConstraint;
      contr.push({ id: 'regex', score: r.score, weight: config.weights.regexConstraint, weightedScore, evidence: r.evidence });
    }

    // 5) schema hints (synonyms/token overlap)
    {
      const texts = truthyStrings([bucket.id, bucket.name, bucket.class, bucket.label, bucket.placeholder, bucket['aria-label'], bucket.title]);
      const r = schemaHintScore(key, texts, config.synonyms);
      const weightedScore = r.score * config.weights.schemaHint;
      contr.push({ id: 'schema', score: r.score, weight: config.weights.schemaHint, weightedScore, evidence: { matched: r.matched } });
    }

    // 6) fuzzy string similarity
    const fuzzy = (() => {
      const texts = truthyStrings([bucket.label, bucket.placeholder, bucket['aria-label'], bucket.title, bucket.name, bucket.id]);
      const r = fuzzyScore(key, texts);
      const weightedScore = r.score * config.weights.fuzzy;
      return { weightedScore, r };
    })();
    contr.push({ id: 'fuzzy', score: fuzzy.r.score, weight: config.weights.fuzzy, weightedScore: fuzzy.weightedScore, evidence: fuzzy.r.evidence });

    // Combine
    const totalWeighted = contr.reduce((s, c) => s + c.weightedScore, 0);
    const maxWeight = Object.values(config.weights).reduce((s, w) => s + w, 0);
    const totalScore = Math.max(0, Math.min(1, totalWeighted / Math.max(1e-6, maxWeight)));

    const explanation: MatchExplanation = {
      totalScore,
      contributions: contr,
      highlights: fuzzy.r.highlights
    };

    const tier = pickTier(totalScore, config);

    results.push({ key, candidate: cand, score: totalScore, rank: 0, explanation, tier });
  }

  results.sort((a, b) => b.score - a.score);
  results.forEach((r, i) => (r.rank = i + 1));
  return results;
}

export function rankKeysForCandidate(candidate: Candidate, keys: OntologyKey[], cfg?: Partial<MatcherConfig>): MatchResult[] {
  const results = keys.flatMap((k) => rankCandidatesForKey(k, [candidate], cfg));
  results.sort((a, b) => b.score - a.score);
  results.forEach((r, i) => (r.rank = i + 1));
  return results;
}

export interface BatchMatchResult {
  byKey: Record<string, MatchResult[]>;
  byCandidate: Record<string, MatchResult[]>;
}

export function computeBatchMatches(keys: OntologyKey[], candidates: Candidate[], cfg?: Partial<MatcherConfig>): BatchMatchResult {
  const byKey: Record<string, MatchResult[]> = {};
  const byCandidate: Record<string, MatchResult[]> = {};

  for (const key of keys) {
    const ranked = rankCandidatesForKey(key, candidates, cfg);
    byKey[key.key] = ranked;
    for (const r of ranked) {
      if (!byCandidate[r.candidate.id]) byCandidate[r.candidate.id] = [];
      byCandidate[r.candidate.id].push(r);
    }
  }

  for (const id of Object.keys(byCandidate)) {
    byCandidate[id].sort((a, b) => b.score - a.score);
    byCandidate[id].forEach((r, i) => (r.rank = i + 1));
  }

  return { byKey, byCandidate };
}
