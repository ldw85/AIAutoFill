import { startDomScanner } from './domScanner';
import App from './ui/App.svelte';
import { setKeys, updateScan, refreshHighlights } from './ui/state';
import { DEFAULT_KEYS, DEFAULT_VALUES, SYNONYMS_OVERLAY } from './ui/keys';
import type { SemanticConfig } from '../lib/semantic';

console.info('AIAutoFill content script loaded');

// Mount overlay UI
const host = document.createElement('div');
host.id = 'aiaf-overlay-host';
document.documentElement.appendChild(host);
const app = new App({ target: host });
void app;

// Initialize keys with default values
const semanticEnabled = (import.meta.env.VITE_SEMANTIC_ENABLED as string) === 'true';
const embeddingsUrl = (import.meta.env.VITE_EMBEDDINGS_URL as string) || '';
const semanticCfg: SemanticConfig | undefined = semanticEnabled && embeddingsUrl
  ? {
      enabled: true,
      apiUrl: embeddingsUrl,
      model: (import.meta.env.VITE_EMBEDDINGS_MODEL as string) || 'MiniLM',
      batchSize: Number(import.meta.env.VITE_EMBEDDINGS_BATCH_SIZE || 64),
      timeoutMs: Number(import.meta.env.VITE_EMBEDDINGS_TIMEOUT_MS || 4000),
      cacheTtlMs: Number(import.meta.env.VITE_EMBEDDINGS_CACHE_TTL_MS || 24 * 60 * 60 * 1000),
      weight: Number(import.meta.env.VITE_SEMANTIC_WEIGHT || 0.6),
      apiKey: (import.meta.env.VITE_EMBEDDINGS_API_KEY as string) || undefined
    }
  : undefined;

setKeys(
  DEFAULT_KEYS.map((k) => ({ key: k, value: DEFAULT_VALUES[k.key] })),
  { synonyms: SYNONYMS_OVERLAY, semantic: semanticCfg }
);

const scanner = startDomScanner({
  throttleMs: 600,
  onCandidates: (result) => {
    const count = result.candidates.length;
    // eslint-disable-next-line no-console
    console.debug(
      '[AIAutoFill] scanned candidates:',
      count,
      'at',
      new Date(result.scannedAt).toISOString()
    );
    const w = window as unknown as Record<string, unknown>;
    w.__AIAutoFill_lastScan__ = result;

    // feed into UI state and refresh highlights
    updateScan(result, { synonyms: SYNONYMS_OVERLAY, semantic: semanticCfg });
    refreshHighlights();
  }
});

// Expose for debugging
(window as unknown as Record<string, unknown>).__AIAutoFillScanner__ = scanner;

// Example: respond to messages from the extension
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_PAGE_INFO') {
    const title = document.title;
    const w = window as unknown as { __AIAutoFill_lastScan__?: { candidates?: unknown[] } };
    const count = w.__AIAutoFill_lastScan__?.candidates?.length ?? 0;
    sendResponse({ title, candidateCount: count });
  }
});
