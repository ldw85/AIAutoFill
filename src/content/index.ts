import { startDomScanner } from './domScanner';
import App from './ui/App.svelte';
import { setKeys, updateScan, refreshHighlights } from './ui/state';
import { DEFAULT_KEYS, DEFAULT_VALUES, SYNONYMS_OVERLAY } from './ui/keys';

console.info('AIAutoFill content script loaded');

// Mount overlay UI
const host = document.createElement('div');
host.id = 'aiaf-overlay-host';
document.documentElement.appendChild(host);
const app = new App({ target: host });
void app;

// Initialize keys with default values
setKeys(
  DEFAULT_KEYS.map((k) => ({ key: k, value: DEFAULT_VALUES[k.key] })),
  { synonyms: SYNONYMS_OVERLAY }
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
    updateScan(result, { synonyms: SYNONYMS_OVERLAY });
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
