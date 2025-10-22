import { test as base, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FixtureServer } from './server';
import { ROUTE_MAP } from './forms';

const EXTENSION_DIST_PATH = path.resolve(__dirname, '../../..', 'dist');

export const test = base.extend<{
  server: FixtureServer;
}>({
  server: [
    async (_opts, use) => {
      const server = new FixtureServer(ROUTE_MAP);
      await server.start();
      try {
        await use(server);
      } finally {
        await server.stop();
      }
    },
    { scope: 'worker' }
  ],
  context: [
    async (_opts, use) => {
      if (!fs.existsSync(EXTENSION_DIST_PATH)) {
        throw new Error(`Extension build not found at ${EXTENSION_DIST_PATH}. Run npm run build before tests.`);
      }

      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaf-playwright-'));
      const launchArgs = [
        `--disable-extensions-except=${EXTENSION_DIST_PATH}`,
        `--load-extension=${EXTENSION_DIST_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ];
      const headless = process.env.PLAYWRIGHT_HEADLESS === '1' || process.env.CI === 'true';
      if (headless) {
        launchArgs.push('--headless=new');
      }

      const context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        args: launchArgs
      });

      for (const page of context.pages()) {
        try {
          await page.close();
        } catch {
          // ignore closing errors for chrome:// pages
        }
      }

      try {
        await use(context);
      } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    },
    { scope: 'worker' }
  ],
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  }
});

export { expect } from '@playwright/test';
