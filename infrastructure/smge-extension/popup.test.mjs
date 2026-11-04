import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

const executablePath =
  process.env.SMGE_TEST_BROWSER ??
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(existsSync);

test(
  'Toolkit UI preserves sender, collector and diagnostic v2 protocols without contacting TikTok',
  { skip: !executablePath, timeout: 30000 },
  async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const context = await browser.newContext({ acceptDownloads: true });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const state = (window.toolkitTest = {
          tab: {
            id: 1,
            url: 'http://localhost:3000/outbound?account=11111111-1111-4111-8111-111111111111',
          },
          runtime: [],
          commands: [],
          scripts: [],
          active: false,
          running: false,
          count: 0,
          denyFrames: false,
        });
        window.chrome = {
          runtime: {
            getManifest: () => ({ version: '1.0.1', version_name: '1.0.1 (DM Sender 0.2.7)' }),
            sendMessage: async (message) => {
              state.runtime.push(message);
              if (message.action === 'start') state.active = true;
              if (message.action === 'stop') state.active = false;
              return message.action === 'status'
                ? {
                    active: state.active,
                    detail: state.active ? 'Antrean berjalan' : 'Antrean dihentikan',
                  }
                : { ok: true };
            },
          },
          permissions: { request: async () => true },
          tabs: {
            query: async () => [state.tab],
            sendMessage: async (_id, message) => {
              state.commands.push(message);
              if (message.action === 'start') state.running = true;
              if (message.action === 'stop') {
                state.running = false;
                state.count = 1;
              }
              return message.action === 'export'
                ? {
                    batch: {
                      format: 'smge-followers-v1',
                      accountUsername: 'source_test',
                      followers: [{ username: 'recipient_test' }],
                    },
                  }
                : {
                    running: state.running,
                    count: state.count,
                    accountUsername: 'source_test',
                    reason: 'Siap',
                  };
            },
          },
          scripting: {
            executeScript: async (args) => {
              state.scripts.push({ target: args.target, files: args.files });
              if (state.denyFrames && args.target.allFrames)
                throw new Error('Frame permission denied');
              return args.files
                ? []
                : [{ frameId: 0, result: { path: '/messages', elements: [], handles: [] } }];
            },
          },
        };
      });
      await page.goto(pathToFileURL(fileURLToPath(new URL('./popup.html', import.meta.url))).href);
      await page.locator('#tile-sender').click();
      await page.locator('#s-confirm').check();
      await page.locator('#s-start').click();
      await page.getByRole('status').filter({ hasText: 'Antrean berjalan' }).waitFor();
      const starts = await page.evaluate(() =>
        window.toolkitTest.runtime.filter((item) => item.action === 'start'),
      );
      assert.equal(starts.length, 1);
      assert.equal(starts[0].accountId, '11111111-1111-4111-8111-111111111111');
      await page.locator('#s-stop').click();
      await page.getByRole('status').filter({ hasText: 'Antrean dihentikan' }).waitFor();
      await page.locator('#back').click();
      await page.evaluate(() => {
        window.toolkitTest.tab.url = 'https://www.tiktok.com/@source_test';
      });
      await page.locator('[data-view="collector"]').click();
      await page.locator('#c-confirm').check();
      await page.locator('#c-start').click();
      await page.locator('#c-stop').click();
      const exported = page.waitForEvent('download');
      await page.locator('#c-export').click();
      const followers = JSON.parse(await readFile(await (await exported).path(), 'utf8'));
      assert.equal(followers.accountUsername, 'source_test');
      await page.locator('#back').click();
      await page.evaluate(() => {
        window.toolkitTest.tab.url = 'https://www.tiktok.com/messages';
      });
      await page.locator('[data-view="diagnostic"]').click();
      for (const denied of [false, true]) {
        await page.evaluate((value) => {
          window.toolkitTest.denyFrames = value;
        }, denied);
        const exportedDiagnostic = page.waitForEvent('download');
        await page.locator('#d-run').click();
        const diagnostic = JSON.parse(
          await readFile(await (await exportedDiagnostic).path(), 'utf8'),
        );
        assert.equal(diagnostic.format, 'smge-dm-diagnostic-v2');
        assert.equal(diagnostic.frameScan, denied ? 'top-frame-only' : 'accessible-frames');
      }
      assert.deepEqual(errors, []);
      const files = await page.evaluate(() =>
        window.toolkitTest.scripts.flatMap((item) => item.files ?? []),
      );
      assert.ok(files.includes('diagnostics.js'));
      assert.ok(files.includes('collector.js'));
    } finally {
      await browser.close();
    }
  },
);
