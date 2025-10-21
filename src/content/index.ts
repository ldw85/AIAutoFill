import { startDomScanner } from './domScanner';

console.info('AIAutoFill content script loaded');

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
