// Run against the local dashboard; intercept every API request, never send email.
const { chromium } = require('playwright-core');
const { PERMISSIONS } = require('@smge/shared');
const assert = require('node:assert/strict');
const baseURL = process.env.DASHBOARD_TEST_URL || 'http://localhost:3000';
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
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addCookies([{ name: 'smge_rt', value: 'mock', url: baseURL }]);
    let enabled = false;
    let fail = true;
    let templates = [];
    let messages = [];
    const submissions = [];
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      let json = {};
      if (path.endsWith('/auth/me'))
        json = {
          id: 'email-ui',
          name: 'Tester',
          email: 'test@example.invalid',
          role: 'MARKETING_OPERATOR',
          permissions: Object.values(PERMISSIONS),
        };
      else if (path.endsWith('/email-outreach/config'))
        json = {
          enabled,
          sender: 'MBG <marketing@example.invalid>',
          maxRecipients: 30,
          dailyLimit: 100,
        };
      else if (path.endsWith('/email-outreach/templates')) {
        if (method === 'POST') templates.push({ id: 'template-1', ...request.postDataJSON() });
        json = method === 'GET' ? templates : templates[0];
      } else if (path.endsWith('/email-outreach')) {
        if (method === 'POST') {
          const input = request.postDataJSON();
          submissions.push(input);
          if (fail)
            return route.fulfill({ status: 503, json: { message: 'Pengiriman uji belum aktif.' } });
          messages = input.recipients.map((r, index) => ({
            id: `mail-${index}`,
            recipient: r.email,
            recipientName: r.name,
            sender: 'marketing@example.invalid',
            subject: input.subject.replace('{{nama}}', r.name),
            body: input.body.replace('{{nama}}', r.name),
            status: 'QUEUED',
            detail: null,
            createdAt: '2026-11-04T00:00:00Z',
          }));
          json = { queued: messages.length };
        } else json = { items: messages, counts: { QUEUED: messages.length } };
      } else if (path.endsWith('/cancel')) {
        messages[0].status = 'CANCELLED';
        json = { ok: true };
      }
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(`${baseURL}/email`);
    await page.getByRole('heading', { name: 'Kirim Email', exact: true }).waitFor();
    await page.getByText('Pengiriman email belum aktif', { exact: true }).waitFor();
    await page
      .getByLabel('Email penerima', { exact: true })
      .fill('Budi <budi@example.invalid>\nbudi@example.invalid\nSari <sari@example.invalid>');
    assert.equal(await page.getByRole('button', { name: 'Tinjau & kirim' }).isEnabled(), false);
    await page.getByRole('button', { name: 'Simpan sebagai template' }).click();
    await page.getByLabel('Nama template', { exact: true }).fill('Perkenalan saya');
    await page.getByRole('button', { name: 'Simpan template', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(templates.length, 1);
    enabled = true;
    await page.reload();
    await page
      .getByLabel('Email penerima', { exact: true })
      .fill(
        'Budi <budi@example.invalid>\nBudi <budi@example.invalid>\nSari <sari@example.invalid>',
      );
    await page.getByLabel('Pakai template', { exact: true }).selectOption('template-1');
    await page.getByRole('button', { name: 'Tinjau & kirim' }).click();
    const dialog = page.getByRole('dialog');
    assert.match(await dialog.innerText(), /Halo Budi/);
    assert.match(await dialog.innerText(), /Halo Sari/);
    const send = dialog.getByRole('button', { name: 'Kirim 2 email', exact: true });
    assert.equal(await send.isEnabled(), false);
    await dialog.getByRole('checkbox').check();
    await send.click();
    await dialog.getByText('Pengiriman uji belum aktif.', { exact: true }).waitFor();
    fail = false;
    await send.click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(submissions.length, 2);
    assert.equal(
      submissions[0].requestId,
      submissions[1].requestId,
      'retry after failed request retains idempotency key',
    );
    assert.equal(submissions[1].recipients.length, 2);
    await page.getByRole('button', { name: 'Lihat pesan', exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Batalkan', exact: true }).first().click();
    await page.getByText('Dibatalkan', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Tulis email', exact: true }).click();
    await page.screenshot({
      path: process.env.EMAIL_SCREENSHOT || 'C:/laragon/tmp/mbg-email-page.png',
      fullPage: true,
    });
    console.log(
      'PASS: SMTP disabled state, personal template, personalized review, recipient dedup, explicit confirmation, idempotent retry and cancellation',
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
