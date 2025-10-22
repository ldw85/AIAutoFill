import { startDomScanner, type Candidate } from './domScanner';
import App from './ui/App.svelte';
import {
  keys,
  updateScan,
  refreshHighlights,
  recomputeBatch,
  applyAll,
  undoAll,
  batch,
  readCandidateValue,
  candidatesView,
  getElementForCandidate,
  scan as scanStore,
  isApplied,
  type KeyConfig
} from './ui/state';
import { DEFAULT_KEYS, DEFAULT_VALUES, SYNONYMS_OVERLAY } from './ui/keys';
import type { SemanticConfig } from '../lib/semantic';
import {
  loadSettings,
  normalizeSettings,
  findTemplate,
  SETTINGS_STORAGE_KEY,
  type ExtensionSettings
} from '../lib/settings';
import type { BatchMatchResult, MatchResult } from '../lib/fieldMatcher';
import { get } from 'svelte/store';

console.info('AIAutoFill content script loaded');

// Mount overlay UI
const host = document.createElement('div');
host.id = 'aiaf-overlay-host';
document.documentElement.appendChild(host);
const app = new App({ target: host });
void app;

// Semantic configuration derived from environment + runtime settings
const envSemanticEnabled = (import.meta.env.VITE_SEMANTIC_ENABLED as string) === 'true';
const embeddingsUrl = (import.meta.env.VITE_EMBEDDINGS_URL as string) || '';
const embeddingsModel = (import.meta.env.VITE_EMBEDDINGS_MODEL as string) || 'MiniLM';
const embeddingsBatchSize = Number(import.meta.env.VITE_EMBEDDINGS_BATCH_SIZE || 64);
const embeddingsTimeoutMs = Number(import.meta.env.VITE_EMBEDDINGS_TIMEOUT_MS || 4000);
const embeddingsCacheTtl = Number(import.meta.env.VITE_EMBEDDINGS_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const semanticWeight = Number(import.meta.env.VITE_SEMANTIC_WEIGHT || 0.6);
const embeddingsApiKey = (import.meta.env.VITE_EMBEDDINGS_API_KEY as string) || undefined;

let semanticCfg: SemanticConfig | undefined;

function computeSemanticConfig(settings: ExtensionSettings): SemanticConfig | undefined {
  if (!envSemanticEnabled) return undefined;
  if (!embeddingsUrl) return undefined;
  if (settings.offlineMode) return undefined;
  if (!settings.semanticMatching) return undefined;
  return {
    enabled: true,
    apiUrl: embeddingsUrl,
    model: embeddingsModel,
    batchSize: embeddingsBatchSize,
    timeoutMs: embeddingsTimeoutMs,
    cacheTtlMs: embeddingsCacheTtl,
    weight: semanticWeight,
    apiKey: embeddingsApiKey
  };
}

function matcherConfig(): { synonyms: typeof SYNONYMS_OVERLAY; semantic?: SemanticConfig } {
  return { synonyms: SYNONYMS_OVERLAY, semantic: semanticCfg };
}

function buildKeyConfigs(values: Record<string, unknown> | undefined, fallbackToDefaults: boolean): KeyConfig[] {
  return DEFAULT_KEYS.map((ontologyKey) => {
    const hasOverride = values ? Object.prototype.hasOwnProperty.call(values, ontologyKey.key) : false;
    if (hasOverride && values) {
      return { key: ontologyKey, value: values[ontologyKey.key] };
    }
    if (fallbackToDefaults) {
      return { key: ontologyKey, value: DEFAULT_VALUES[ontologyKey.key] };
    }
    return { key: ontologyKey, value: undefined };
  });
}

function templateValues(settings: ExtensionSettings): Record<string, unknown> | undefined {
  const template = findTemplate(settings, settings.quickFillTemplateId || settings.quickExtractTemplateId);
  return template?.values;
}

function applySettings(settings: ExtensionSettings): void {
  semanticCfg = computeSemanticConfig(settings);
  const values = templateValues(settings);
  const configs = buildKeyConfigs(values, !values);
  keys.set(configs);
  void recomputeBatch(matcherConfig());
  refreshHighlights();
}

async function initialiseSettings(): Promise<void> {
  const loaded = await loadSettings();
  applySettings(loaded);
}

void initialiseSettings();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!Object.prototype.hasOwnProperty.call(changes, SETTINGS_STORAGE_KEY)) return;
  const nextRaw = changes[SETTINGS_STORAGE_KEY]?.newValue as Partial<ExtensionSettings> | null | undefined;
  const next = normalizeSettings(nextRaw || undefined);
  applySettings(next);
});

// Initialize keys with default values immediately for UI responsiveness
const initialConfigs = buildKeyConfigs(undefined, true);
keys.set(initialConfigs);
void recomputeBatch(matcherConfig());

const scanner = startDomScanner({
  throttleMs: 600,
  onCandidates: (result) => {
    const count = result.candidates.length;
    // eslint-disable-next-line no-console
    console.debug(
      '[AIAutoFill] scanned candidates:',
      count,
      'at',
      new Date(result.scannedAt).toISOString(),
      'durationMs',
      result.durationMs
    );
    const w = window as unknown as Record<string, unknown>;
    w.__AIAutoFill_lastScan__ = result;

    // feed into UI state and refresh highlights
    updateScan(result, matcherConfig());
    refreshHighlights();
  }
});

// Expose for debugging
(window as unknown as Record<string, unknown>).__AIAutoFillScanner__ = scanner;

async function applyTemplate(values: Record<string, unknown> | undefined): Promise<number> {
  const configs = buildKeyConfigs(values, false);
  keys.set(configs);
  await recomputeBatch(matcherConfig());
  const applied = applyAll();
  refreshHighlights();
  return applied;
}

function bestMatches(): Map<string, MatchResult> {
  const out = new Map<string, MatchResult>();
  const currentBatch: BatchMatchResult | null = get(batch);
  if (!currentBatch) return out;
  const entries = Object.entries(currentBatch.byKey || {});
  for (const [key, list] of entries) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const best = list[0];
    if (!best || best.tier === 'reject') continue;
    out.set(key, best);
  }
  return out;
}

function extractCurrentValues(): Record<string, unknown> {
  const matches = bestMatches();
  if (matches.size === 0) return {};
  const result: Record<string, unknown> = {};
  for (const [key, match] of matches.entries()) {
    const value = readCandidateValue(match.candidate);
    if (value == null) continue;
    if (typeof value === 'string' && value.trim().length === 0) continue;
    result[key] = value;
  }
  return result;
}

// Respond to extension messages
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_PAGE_INFO') {
    const title = document.title;
    const w = window as unknown as { __AIAutoFill_lastScan__?: { candidates?: Candidate[] } };
    const count = w.__AIAutoFill_lastScan__?.candidates?.length ?? 0;
    sendResponse({ title, candidateCount: count });
    return;
  }

  if (msg?.type === 'AIAF_APPLY_TEMPLATE') {
    void (async () => {
      try {
        const values = (msg.values as Record<string, unknown>) || {};
        const applied = await applyTemplate(values);
        sendResponse({ type: 'AIAF_APPLY_TEMPLATE_RESULT', applied });
      } catch (error) {
        sendResponse({
          type: 'AIAF_APPLY_TEMPLATE_RESULT',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    })();
    return true;
  }

  if (msg?.type === 'AIAF_EXTRACT_TEMPLATE') {
    try {
      const data = extractCurrentValues();
      sendResponse({ type: 'AIAF_EXTRACT_TEMPLATE_RESULT', data });
    } catch (error) {
      sendResponse({
        type: 'AIAF_EXTRACT_TEMPLATE_RESULT',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    return;
  }
});

interface TestMatchSummary {
  candidateId: string;
  tier: MatchResult['tier'];
  score: number;
  label: string | null;
  path: string;
}

interface TestCandidateStatus {
  id: string;
  key: string | null;
  status: string | null;
  applied: boolean;
  highlight: string | null;
}

function scanMetricsSnapshot(): { scannedAt: number; candidateCount: number; durationMs: number } | null {
  const current = get(scanStore);
  if (!current) return null;
  return {
    scannedAt: current.scannedAt,
    candidateCount: current.candidates.length,
    durationMs: current.durationMs
  };
}

function topMatchSummaries(): Record<string, TestMatchSummary> {
  const current: BatchMatchResult | null = get(batch);
  if (!current) return {};
  const summaries: Record<string, TestMatchSummary> = {};
  for (const [key, matches] of Object.entries(current.byKey || {})) {
    if (!Array.isArray(matches) || matches.length === 0) continue;
    const best = matches[0];
    if (!best) continue;
    summaries[key] = {
      candidateId: best.candidate.id,
      tier: best.tier,
      score: Number(best.score.toFixed(3)),
      label: best.candidate.accessibleName?.value ?? null,
      path: best.candidate.path
    };
  }
  return summaries;
}

function candidateStatusSummaries(): TestCandidateStatus[] {
  return get(candidatesView).map((view) => {
    const el = getElementForCandidate(view.candidate);
    const highlight = el
      ? Array.from(el.classList).find((cls) => cls.startsWith('aiaf-highlight-')) ?? null
      : null;
    return {
      id: view.candidate.id,
      key: view.key?.key ?? null,
      status: view.status ?? null,
      applied: isApplied(view.candidate.id),
      highlight
    };
  });
}

const testApi = Object.freeze({
  applyAll: () => applyAll(),
  undoAll: () => undoAll(),
  rescan: () => {
    scanner.rescanNow();
    return true;
  },
  getScanMetrics: () => scanMetricsSnapshot(),
  getTopMatches: () => topMatchSummaries(),
  getCandidateStatuses: () => candidateStatusSummaries()
});

(window as unknown as Record<string, unknown>).__AIAutoFillTestAPI__ = testApi;
