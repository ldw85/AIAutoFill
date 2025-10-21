import type { Candidate } from '../content/domScanner';
import type { BatchMatchResult, HeuristicContribution, MatchResult } from './fieldMatcher';
import type { MatcherConfig, OntologyKey } from './ontology';

export interface SemanticConfig {
  enabled: boolean;
  apiUrl: string; // URL for embeddings service
  apiKey?: string; // optional Authorization header bearer token
  model?: string; // e.g., 'MiniLM', 'TinyBERT'
  batchSize?: number; // default 64
  timeoutMs?: number; // default 4000ms
  cacheTtlMs?: number; // default 24h
  weight?: number; // contribution weight [0..1], default 0.6
}

// In-memory embedding cache scoped to the content-script session
const EMB_CACHE = new Map<string, { v: number[]; ts: number }>();

function nowMs() {
  return Date.now();
}

function normalizeCacheKey(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function cosineSim(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(Math.max(1e-9, na)) * Math.sqrt(Math.max(1e-9, nb));
  return denom > 0 ? clamp01((dot / denom + 1) / 2) : 0; // map [-1,1] -> [0,1]
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function fetchEmbeddings(texts: string[], cfg: SemanticConfig): Promise<number[][]> {
  // Minimal context: labels only are passed via `texts`
  const payload: Record<string, unknown> = { model: cfg.model || 'MiniLM' };
  // Prefer `input`, but support `texts` for compatibility
  payload.input = texts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const res = await fetchWithTimeout(cfg.apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  }, cfg.timeoutMs ?? 4000);

  if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}`);
  const json: unknown = await res.json();
  // Support multiple common response shapes
  // 1) { embeddings: number[][] }
  // 2) { vectors: number[][] }
  // 3) { data: Array<{ embedding: number[] }> }
  const obj = json as Record<string, unknown>;
  let vectors: number[][] | null = null;
  if (Array.isArray(obj.embeddings)) vectors = obj.embeddings as number[][];
  else if (Array.isArray(obj.vectors)) vectors = obj.vectors as number[][];
  else if (Array.isArray(obj.data)) vectors = (obj.data as Array<{ embedding: number[] }>).map((d) => d.embedding);

  if (!vectors || !Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error('Invalid embeddings response');
  }
  return vectors;
}

async function getEmbeddingsFor(texts: string[], cfg: SemanticConfig): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const now = nowMs();
  const ttl = cfg.cacheTtlMs ?? 24 * 60 * 60 * 1000;

  const toFetch: string[] = [];
  for (const raw of texts) {
    const key = normalizeCacheKey(raw);
    const cached = EMB_CACHE.get(key);
    if (cached && now - cached.ts < ttl) {
      out.set(raw, cached.v);
    } else {
      toFetch.push(raw);
    }
  }

  if (toFetch.length === 0) return out;

  const batchSize = Math.max(1, cfg.batchSize ?? 64);
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const chunk = toFetch.slice(i, i + batchSize);
    try {
      const vecs = await fetchEmbeddings(chunk, cfg);
      for (let j = 0; j < chunk.length; j++) {
        const raw = chunk[j];
        const key = normalizeCacheKey(raw);
        const v = vecs[j] || [];
        EMB_CACHE.set(key, { v, ts: now });
        out.set(raw, v);
      }
    } catch (e) {
      // On failure, do not throw; graceful degradation occurs upstream
      // eslint-disable-next-line no-console
      console.warn('[AIAutoFill] embeddings fetch failed; falling back', e);
      // break early; return what we have
      return out;
    }
  }
  return out;
}

function recomputeTotals(results: MatchResult[], config: MatcherConfig): void {
  for (const r of results) {
    const totalWeighted = r.explanation.contributions.reduce((s, c) => s + c.weightedScore, 0);
    const maxWeight = Object.values(config.weights).reduce((s, w) => s + (w || 0), 0);
    const totalScore = Math.max(0, Math.min(1, totalWeighted / Math.max(1e-6, maxWeight)));
    r.explanation.totalScore = totalScore;
    r.score = totalScore;
  }
}

function pickTier(score: number, config: MatcherConfig): 'accept' | 'consider' | 'reject' {
  if (score >= config.thresholds.accept) return 'accept';
  if (score >= config.thresholds.consider) return 'consider';
  return 'reject';
}

export async function rerankWithSemantics(
  base: BatchMatchResult,
  keys: OntologyKey[],
  candidates: Candidate[],
  config: MatcherConfig & { semantic?: SemanticConfig }
): Promise<BatchMatchResult> {
  const sc = config.semantic;
  if (!sc?.enabled || !sc.apiUrl) return base;

  try {
    // Gather minimal context: only key labels and candidate accessible labels
    const keyTexts = keys.map((k) => (k.label || k.key)).filter(Boolean) as string[];
    const candById = new Map<string, Candidate>();
    const candLabelById = new Map<string, string>();
    for (const c of candidates) {
      const label = (c.accessibleName?.value || '').toString().trim();
      if (label) {
        candById.set(c.id, c);
        candLabelById.set(c.id, label);
      }
    }

    const allTexts = Array.from(new Set<string>([...keyTexts, ...Array.from(candLabelById.values())]));
    const embeds = await getEmbeddingsFor(allTexts, sc);

    if (embeds.size === 0) return base; // offline or service unavailable

    const keyVecByText = new Map<string, number[]>();
    for (const t of keyTexts) {
      const v = embeds.get(t);
      if (v) keyVecByText.set(t, v);
    }

    const candVecById = new Map<string, number[]>();
    for (const [id, label] of candLabelById.entries()) {
      const v = embeds.get(label);
      if (v) candVecById.set(id, v);
    }

    // Build a quick lookup from key.key -> key label text
    const keyLabelByKey = new Map<string, string>();
    for (const k of keys) keyLabelByKey.set(k.key, (k.label || k.key));

    const weight = sc.weight ?? 0.6;
    const configWithSemantic: MatcherConfig = { ...config, weights: { ...config.weights, semantic: weight } };

    // Augment contributions with semantic score and recompute totals
    const entries = Object.entries(base.byKey) as Array<[string, MatchResult[]]>;
    for (const [keyStr, list] of entries) {
      const keyLabel = keyLabelByKey.get(keyStr);
      if (!keyLabel) continue;
      const keyVec = keyVecByText.get(keyLabel);
      if (!keyVec) continue;

      for (const r of list) {
        const candVec = candVecById.get(r.candidate.id);
        if (!candVec) continue;
        const s = cosineSim(keyVec, candVec);
        const contr: HeuristicContribution = {
          id: 'semantic',
          score: s,
          weight,
          weightedScore: s * weight,
          evidence: { keyLabel, candidateLabel: candLabelById.get(r.candidate.id) }
        };
        r.explanation.contributions.push(contr);
      }

      recomputeTotals(list, configWithSemantic);
      for (const r of list) r.tier = pickTier(r.score, configWithSemantic);
      list.sort((a, b) => b.score - a.score);
      list.forEach((r, i) => (r.rank = i + 1));
    }

    // Rebuild byCandidate from byKey
    const byCandidate: Record<string, MatchResult[]> = {};
    for (const list of Object.values(base.byKey)) {
      for (const r of list) {
        if (!byCandidate[r.candidate.id]) byCandidate[r.candidate.id] = [];
        byCandidate[r.candidate.id].push(r);
      }
    }
    for (const id of Object.keys(byCandidate)) {
      byCandidate[id].sort((a, b) => b.score - a.score);
      byCandidate[id].forEach((r, i) => (r.rank = i + 1));
    }

    return { byKey: base.byKey, byCandidate };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[AIAutoFill] semantic rerank failed; falling back', e);
    return base; // graceful degradation
  }
}

export function logSemanticPrivacyNoticeOnce(sc?: SemanticConfig) {
  const g = globalThis as unknown as { __AIAF__SEM_NOTICE__?: boolean };
  if (g.__AIAF__SEM_NOTICE__) return;
  if (!sc?.enabled) return;
  // eslint-disable-next-line no-console
  console.info('[AIAutoFill] Semantic matching enabled. Minimal context (labels only) may be sent to an external embeddings service. See PRIVACY.md for details.');
  g.__AIAF__SEM_NOTICE__ = true;
}
