// All API traffic is intercepted. No live accounts or messages are changed.
const { chromium } = require('playwright-core');
const { PERMISSIONS } = require('@smge/shared');
const assert = require('node:assert/strict');
const baseURL = process.env.DASHBOARD_TEST_URL || 'http://localhost:3000';
const accountId = '00000000-0000-4000-8000-000000000001';
async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.BROWSER_EXECUTABLE ||
      (process.platform === 'win32'
        ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
        : undefined),
  });
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: 'smge_rt', value: 'mock', url: baseURL }]);
    let rows = [
      {
        id: 'delivery-1',
        taskId: 'task-1',
        username: 'recipient_test',
        senderUsername: 'bonoinn',
        status: 'QUEUED',
        detail: null,
        attemptId: 'attempt-1',
        updatedAt: '2026-11-04T00:00:00Z',
      },
    ];
    let reads = 0;
    let mutations = 0;
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      if (request.method() !== 'GET') mutations++;
      const path = new URL(request.url()).pathname;
      let json = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
      if (path.endsWith('/auth/me'))
        json = {
          id: 'popup-test',
          name: 'Tester',
          email: 'test@example.invalid',
          role: 'MARKETING_OPERATOR',
          permissions: Object.values(PERMISSIONS),
        };
      else if (path.endsWith('/tiktok-accounts'))
        json.items = [{ id: accountId, username: 'bonoinn', status: 'ACTIVE', lane: 'OUTBOUND' }];
      else if (path.endsWith('/browser-dm')) {
        reads++;
        json = rows;
      } else if (path.includes('/outbound/summary/'))
        json = { createdToday: 1, dailyLimit: 30, byStatus: {}, sentToday: 0 };
      else if (path.endsWith('/message-templates')) json = [];
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.clock.install();
    await page.goto(`${baseURL}/outbound?account=${accountId}`);
    await page.getByText('@recipient_test', { exact: true }).waitFor();
    assert.equal(await page.getByRole('alertdialog').count(), 0);
    async function poll(next) {
      rows = [next];
      const before = reads;
      await page.clock.fastForward(5100);
      await page.waitForFunction(() => true);
      for (let i = 0; reads === before && i < 50; i++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(reads > before, 'poll fetched the new result');
    }
    const failed = {
      ...rows[0],
      status: 'FAILED',
      detail:
        'Akun TikTok login @leocoretechnology berbeda dengan pengirim @bonoinn. Tidak membuka chat.',
    };
    await poll(failed);
    const dialog = page.getByRole('alertdialog');
    await dialog.getByText('Periksa akun TikTok pengirim', { exact: true }).waitFor();
    assert.match(await dialog.innerText(), /@bonoinn/);
    assert.match(await dialog.innerText(), /@leocoretechnology/);
    await dialog.getByRole('button', { name: 'Mengerti' }).click();
    await poll(failed);
    assert.equal(await dialog.count(), 0, 'poll does not repeat the same error');
    await page.reload();
    await page.getByRole('button', { name: 'Lihat penjelasan' }).waitFor();
    assert.equal(await dialog.count(), 0, 'reload remembers the dismissed event');
    await page.getByRole('button', { name: 'Lihat penjelasan' }).click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Mengerti' }).click();
    await poll({ ...failed, attemptId: 'attempt-2', updatedAt: '2026-11-04T00:01:00Z' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Mengerti' }).click();
    await poll({
      ...failed,
      attemptId: 'attempt-3',
      detail:
        'Akun login TikTok berbeda atau tidak dapat ditentukan dengan pasti. Tidak membuka chat.',
    });
    await dialog.getByText('Belum dapat dipastikan dari percobaan ini', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Mengerti' }).click();
    await poll({ ...failed, status: 'UNVERIFIED', detail: 'Hasil pengiriman belum pasti.' });
    await dialog.getByText('Periksa hasil pengiriman', { exact: true }).waitFor();
    assert.match(await dialog.innerText(), /Jangan langsung mengirim ulang/);
    assert.equal(mutations, 0, 'notification never retries or changes a delivery');
    console.log(
      'PASS: mismatch identities, polling/reload dedup, reopen, new attempt, legacy error, uncertain outcome',
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
