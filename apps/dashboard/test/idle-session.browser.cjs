// Run against the local dashboard. All API requests are mocked; no live sessions are changed.
const { chromium } = require('playwright-core');
const { PERMISSIONS } = require('@smge/shared');
const assert = require('node:assert/strict');

const baseURL = process.env.DASHBOARD_TEST_URL || 'http://localhost:3000';
const executablePath =
  process.env.BROWSER_EXECUTABLE ||
  (process.platform === 'win32'
    ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    : undefined);

async function fixture(browser, mode = 'success') {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'smge_rt', value: 'mock', url: baseURL }]);
  const requests = { logout: 0, refresh: 0 };
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/refresh')) {
      requests.refresh++;
      if (mode === 'slow-refresh') return; // Deliberately leave the request unresolved.
      return route.fulfill({ status: 401, json: { message: 'Expired session' } });
    }
    if (path.endsWith('/auth/logout')) {
      requests.logout++;
      return route.fulfill({
        status: mode === 'success' ? 200 : 401,
        json: { ok: mode === 'success' },
      });
    }
    if (path.endsWith('/auth/me')) {
      return route.fulfill({
        status: mode === 'cold-expiry' ? 401 : 200,
        json: {
          id: 'idle-test',
          name: 'Tester',
          email: 'test@example.invalid',
          role: 'MARKETING_OPERATOR',
          permissions: Object.values(PERMISSIONS),
        },
      });
    }
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/ai-sales`);
  if (mode !== 'cold-expiry') {
    await page.getByText('Akses ditolak', { exact: true }).waitFor();
  }
  return { context, page, requests };
}

async function main() {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const normal = await fixture(browser);
    await normal.page.clock.install();
    await normal.page.clock.fastForward(29 * 60 * 1000 + 100);
    await normal.page.getByRole('button', { name: 'Tetap masuk' }).waitFor();
    assert.equal(normal.requests.logout, 0);
    await normal.page.getByRole('button', { name: 'Tetap masuk' }).click();
    await normal.page.clock.fastForward(28 * 60 * 1000);
    assert.equal(normal.requests.logout, 0);
    await normal.page.clock.fastForward(3 * 60 * 1000);
    await normal.page.waitForURL('**/login?reason=session-ended');
    assert.equal(normal.requests.logout, 1);
    await normal.context.close();
    console.log('PASS: warning, activity extension, and 30-minute expiry');

    for (const mode of ['slow-refresh', 'failed-refresh', 'cold-expiry']) {
      const test = await fixture(browser, mode);
      if (mode !== 'cold-expiry') {
        await test.page.clock.install();
        await test.page.clock.fastForward(31 * 60 * 1000);
        await test.page.clock.resume();
      }
      await test.page.waitForURL('**/login?reason=session-ended', { timeout: 10000 });
      await test.page.getByRole('heading', { name: 'Masuk', exact: true }).waitFor();
      assert.ok(test.requests.refresh > 0);
      await test.context.close();
      console.log(`PASS: ${mode} reaches login despite remaining refresh cookie`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
