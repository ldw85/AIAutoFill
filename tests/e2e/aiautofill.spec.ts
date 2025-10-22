import { test, expect } from './fixtures/base';
import { DEFAULT_EXPECTED_VALUES, FORM_FIXTURES, OntologyKey } from './fixtures/forms';
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __AIAutoFillTestAPI__?: {
      applyAll: () => number;
      undoAll: () => number;
      rescan: () => boolean;
      getScanMetrics: () => { scannedAt: number; candidateCount: number; durationMs: number } | null;
      getTopMatches: () => Record<string, { candidateId: string; tier: string; score: number; label: string | null }>;
      getCandidateStatuses: () => Array<{
        id: string;
        key: string | null;
        status: string | null;
        applied: boolean;
        highlight: string | null;
      }>;
    };
  }
}

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__AIAutoFillTestAPI__), { timeout: 10_000 });
}

async function waitForScan(page: Page, minCandidateCount: number): Promise<void> {
  await page.waitForFunction(
    (min) => {
      const api = window.__AIAutoFillTestAPI__;
      if (!api?.getScanMetrics) return false;
      const metrics = api.getScanMetrics();
      return !!metrics && metrics.candidateCount >= min;
    },
    minCandidateCount,
    { timeout: 10_000 }
  );
}

test.describe('AIAutoFill end-to-end automation', () => {
  for (const fixture of FORM_FIXTURES) {
    test(fixture.name, async ({ page, server }) => {
      const url = server.urlFor(fixture.path);
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      await waitForTestApi(page);
      const expectedFieldCount = Object.values(fixture.fields).filter(Boolean).length;
      await waitForScan(page, fixture.minCandidateCount ?? expectedFieldCount);

      const metrics = await page.evaluate(() => window.__AIAutoFillTestAPI__?.getScanMetrics?.() ?? null);
      expect(metrics).not.toBeNull();
      expect(metrics!.candidateCount).toBeGreaterThanOrEqual(fixture.minCandidateCount ?? expectedFieldCount);
      expect(metrics!.durationMs).toBeLessThan(50);

      const expectedKeys = Object.keys(fixture.fields) as OntologyKey[];
      await page.waitForFunction(
        (keys) => {
          const api = window.__AIAutoFillTestAPI__;
          if (!api?.getTopMatches) return false;
          const matches = api.getTopMatches();
          return keys.every((key) => {
            const summary = matches[key];
            return summary && summary.tier !== 'reject';
          });
        },
        expectedKeys,
        { timeout: 10_000 }
      );

      const topMatches = await page.evaluate(() => window.__AIAutoFillTestAPI__?.getTopMatches?.() ?? {});
      for (const key of expectedKeys) {
        expect(topMatches[key], `expected match summary for ${key}`).toBeDefined();
        expect(topMatches[key].tier).not.toBe('reject');
        expect(topMatches[key].score).toBeGreaterThan(0.5);
      }

      const appliedCount = await page.evaluate(() => window.__AIAutoFillTestAPI__?.applyAll?.() ?? 0);
      expect(appliedCount).toBeGreaterThanOrEqual(expectedFieldCount);

      for (const [key, selector] of Object.entries(fixture.fields)) {
        if (!selector) continue;
        const value = DEFAULT_EXPECTED_VALUES[key as OntologyKey];
        const field = page.locator(selector);
        await expect(field).toHaveValue(value);
        await expect(field).toHaveClass(/\baiaf-highlight-filled\b/);
      }

      const candidateStatuses = await page.evaluate(() => window.__AIAutoFillTestAPI__?.getCandidateStatuses?.() ?? []);
      for (const key of expectedKeys) {
        const status = candidateStatuses.find((entry) => entry.key === key);
        expect(status, `expected overlay status for ${key}`).toBeDefined();
        expect(status!.highlight).toBe('aiaf-highlight-filled');
        expect(status!.applied).toBeTruthy();
      }
    });
  }
});
