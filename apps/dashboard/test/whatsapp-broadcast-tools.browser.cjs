// Run against the local dashboard. Every API request is mocked; no WhatsApp message is ever sent.
// node apps/dashboard/test/whatsapp-broadcast-tools.browser.cjs   (BROWSER_EXECUTABLE=<chrome> on macOS/Linux)
const { chromium } = require('playwright-core');
const { PERMISSIONS } = require('@smge/shared');
const assert = require('node:assert/strict');

const baseURL = process.env.DASHBOARD_TEST_URL || 'http://localhost:3000';
const executablePath =
  process.env.BROWSER_EXECUTABLE ||
  (process.platform === 'win32'
    ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    : undefined);

const SESSION = {
  id: 'sess-1',
  label: 'CS 1',
  chatCount: 0,
  historySyncedAt: null,
  historySyncing: false,
  historyChats: 0,
  historyError: null,
  status: 'WORKING',
  connectedNumber: '+62•••••••7890',
  connectedName: 'Nomor Uji',
  problem: null,
  eventsOutdated: false,
  connectionLost: false,
};
const DONE_BROADCAST = {
  id: 'bc-1',
  name: 'Promo lama',
  message: 'Halo {{nama}}',
  status: 'DONE',
  pauseReason: null,
  sessionId: 'sess-1',
  sessionLabel: 'CS 1',
  total: 2,
  sent: 2,
  failed: 0,
  skipped: 0,
  pending: 0,
  nextSendAt: null,
  createdAt: '2026-11-09T00:00:00Z',
  finishedAt: '2026-11-09T01:00:00Z',
  attachment: { filename: 'katalog.pdf', mimetype: 'application/pdf', size: 2097152 },
};

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([{ name: 'smge_rt', value: 'mock', url: baseURL }]);

    const calls = { import: 0, attach: 0, check: [], create: [] };
    let attachMode = 'ok';
    let importMode = 'ok';
    let contactsAvailable = false;
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^\/api/, '');
      const method = request.method();
      if (path === '/auth/me')
        return route.fulfill({
          json: {
            id: 'wa-ui',
            name: 'Tester',
            email: 'test@example.invalid',
            role: 'MARKETING_OPERATOR',
            permissions: Object.values(PERMISSIONS),
          },
        });
      if (path === '/whatsapp/config')
        return route.fulfill({
          json: {
            enabled: true,
            maxSessionsPerUser: 3,
            singleSession: false,
            contactsSync: false,
            newChatsPerDay: 20,
            historySync: false,
            historyDays: 30,
            broadcast: {
              enabled: true,
              maxRecipients: 50,
              perDay: 30,
              minDelaySeconds: 20,
              maxDelaySeconds: 60,
            },
          },
        });
      if (path === '/whatsapp/sessions') return route.fulfill({ json: [SESSION] });
      if (path === '/whatsapp/sessions/health')
        return route.fulfill({ json: { linked: 1, connectionLost: false, lostLabels: [] } });
      if (path === '/whatsapp/chats')
        return route.fulfill({
          json: { items: [], total: 0, page: 1, pageSize: 30, totalPages: 1, unreadTotal: 0 },
        });
      if (path.endsWith('/contacts'))
        return route.fulfill({
          json: contactsAvailable
            ? { available: true, items: [{ phone: '6281000000009', name: 'Zaki', saved: true }] }
            : { available: false, items: [] },
        });
      if (path === '/whatsapp/broadcasts' && method === 'GET')
        return route.fulfill({ json: [DONE_BROADCAST] });
      if (path === '/whatsapp/broadcasts' && method === 'POST') {
        calls.create.push(request.postDataJSON());
        return route.fulfill({ json: { ...DONE_BROADCAST, id: 'bc-2', recipients: [] } });
      }
      if (path === '/whatsapp/broadcasts/attachments') {
        calls.attach++;
        if (attachMode === 'error')
          return route.fulfill({
            status: 400,
            json: {
              message:
                'Hanya gambar JPEG atau PDF yang didukung. Gambar PNG, WebP, atau GIF: ubah ke JPEG dulu.',
            },
          });
        return route.fulfill({
          json: { id: 'att-1', filename: 'brosur.pdf', mimetype: 'application/pdf', size: 1572864 },
        });
      }
      if (path === '/whatsapp/broadcasts/import-recipients') {
        calls.import++;
        if (importMode === 'error')
          return route.fulfill({
            status: 400,
            json: { message: 'File tidak dapat dibaca. Gunakan CSV atau Excel .xlsx.' },
          });
        if (importMode === 'vars')
          return route.fulfill({
            json: {
              recipients: [
                {
                  phone: '081111111111',
                  name: 'Budi',
                  vars: { kota: 'Bandung', email: 'budi@example.invalid' },
                },
                { phone: '081222222222', name: 'Siti', vars: { kota: 'Medan' } },
                { phone: '081333333333', name: 'Tanpa kota', vars: { email: 'x@example.invalid' } },
              ],
              invalid: 0,
              variables: ['kota', 'email'],
            },
          });
        if (importMode === 'empty')
          return route.fulfill({ json: { recipients: [], invalid: 3, variables: [] } });
        return route.fulfill({
          json: {
            recipients: [
              { phone: '0811 1111 1111', name: 'Budi, S.Kom' },
              { phone: '081222222222', name: 'Siti' },
              { phone: '081333333333' },
            ],
            invalid: 2,
            variables: [],
          },
        });
      }
      if (path === '/whatsapp/sessions/sess-1/check-numbers') {
        const { phones } = request.postDataJSON();
        calls.check.push(phones);
        return route.fulfill({
          json: {
            results: phones.map((phone) => ({
              phone,
              status: phone === '6281222222222' ? 'not_registered' : 'registered',
            })),
          },
        });
      }
      if (path === '/whatsapp/broadcasts/bc-1/export')
        return route.fulfill({
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="laporan-kirim-terjadwal-2026-11-10.csv"',
          },
          body: '\uFEFFNomor,Nama,Status,Keterangan,Waktu kirim (WIB)\n',
        });
      return route.fulfill({ json: {} });
    });

    const errors = [];
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

    await page.goto(`${baseURL}/whatsapp?tab=broadcast`);
    await page.getByRole('button', { name: /Kirim terjadwal baru/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();

    // 1. Import: file masuk ke kolom daftar; koma di nama diganti spasi; baris tanpa nama hanya nomor.
    const fileInput = dialog.locator('#bc-file');
    await fileInput.setInputFiles({
      name: 'penerima.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Nama,Nomor\nBudi,0811 1111 1111\n'),
    });
    await dialog.getByText(/3 penerima ditambahkan dari penerima\.csv, 2 baris/).waitFor();
    const list = dialog.locator('#bc-list');
    assert.equal(
      await list.inputValue(),
      'Budi S.Kom, 0811 1111 1111\nSiti, 081222222222\n081333333333',
    );
    await dialog.getByText('3 penerima unik (maks. 50)').waitFor();

    // 2. Import kedua menambah, tidak menimpa, dan duplikat dihitung sekali.
    await fileInput.setInputFiles({
      name: 'lagi.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('x'),
    });
    await dialog.getByText(/3 penerima ditambahkan dari lagi\.csv/).waitFor();
    assert.equal((await list.inputValue()).split('\n').length, 6);
    await dialog.getByText('3 penerima unik (maks. 50)').waitFor();

    // 3. Import gagal: pesan server tampil sebagai alert, daftar tidak berubah.
    importMode = 'error';
    const before = await list.inputValue();
    await fileInput.setInputFiles({
      name: 'rusak.xlsx',
      mimeType: 'application/zip',
      buffer: Buffer.from('z'),
    });
    await dialog
      .getByRole('alert')
      .getByText(/File tidak dapat dibaca/)
      .waitFor();
    assert.equal(await list.inputValue(), before);

    // 4. File tanpa nomor valid: pesan, daftar tetap.
    importMode = 'empty';
    await fileInput.setInputFiles({
      name: 'kosong.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('a'),
    });
    await dialog.getByRole('alert').getByText('Tidak ada nomor yang valid di file ini.').waitFor();
    assert.equal(await list.inputValue(), before);

    // 5. Cek nomor: satu tidak terdaftar, lalu dihapus dari daftar.
    await dialog.getByRole('button', { name: 'Cek nomor di WhatsApp' }).click();
    await dialog.getByText('2 terdaftar · 1 tidak terdaftar').waitFor();
    assert.deepEqual(calls.check.flat().sort(), [
      '6281111111111',
      '6281222222222',
      '6281333333333',
    ]);
    await dialog.getByRole('button', { name: 'Hapus 1 yang tidak terdaftar' }).click();
    await dialog.getByText('2 penerima unik (maks. 50)').waitFor();
    assert.ok(
      !(await list.inputValue()).includes('081222222222'),
      'nomor tidak terdaftar terhapus dari daftar',
    );
    assert.ok((await list.inputValue()).includes('0811 1111 1111'), 'nomor terdaftar tetap ada');

    // 6. Persetujuan tetap wajib sebelum mengirim; setelah dicentang, payload hanya berisi yang tersisa.
    await dialog.getByLabel('Nama (hanya untuk Anda)').fill('Tes impor');
    await dialog.getByLabel('Pesan', { exact: true }).fill('Halo {{nama}}, ada info baru');
    const submit = dialog.getByRole('button', { name: 'Mulai kirim' });
    assert.equal(await submit.isEnabled(), false);
    await dialog.getByRole('checkbox').check();
    await submit.click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(calls.create.length, 1);
    assert.deepEqual(calls.create[0].recipients.map((r) => r.phone).sort(), [
      '0811 1111 1111',
      '081333333333',
    ]);

    // 7. Unduh laporan: tautan unduh ke endpoint ekspor, dan file benar-benar terunduh.
    const link = page.getByRole('link', { name: /Unduh laporan \(CSV\)/ });
    assert.equal(await link.getAttribute('href'), '/api/whatsapp/broadcasts/bc-1/export');
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    // Isi dan header file (CSV, attachment) diverifikasi di e2e API terhadap endpoint asli. Di sini, dengan respons
    // yang di-mock, Chrome headless membatalkan unduhan sebelum tersimpan, jadi yang dicek: tautan memang unduhan
    // dan klik memicu unduhan ke URL ekspor yang benar.
    assert.notEqual(await link.getAttribute('download'), null);
    assert.equal(new URL(download.url()).pathname, '/api/whatsapp/broadcasts/bc-1/export');

    // 7b. Variabel dari kolom file, dan tautan unduh kontak ponsel.
    contactsAvailable = true;
    importMode = 'vars';
    await page.reload(); // daftar kontak di-cache react-query; muat ulang agar mock baru terbaca
    await page.getByRole('button', { name: /Kirim terjadwal baru/ }).click();
    const vd = page.getByRole('dialog');
    await vd.waitFor();
    const contactLink = vd.getByRole('link', { name: 'Unduh semua kontak (CSV)' });
    await contactLink.waitFor();
    assert.equal(
      await contactLink.getAttribute('href'),
      '/api/whatsapp/sessions/sess-1/contacts/export',
    );
    await vd.getByLabel('Nama (hanya untuk Anda)').fill('Dengan variabel');
    await vd.getByLabel('Pesan', { exact: true }).fill('Halo {{nama}} dari {{kota}}');
    // Sebelum ada data: variabel dianggap salah ketik, bukan dikirim mentah.
    await vd
      .getByRole('alert')
      .getByText(/Variabel tidak dikenal: \{\{kota\}\}/)
      .waitFor();
    await vd.locator('#bc-file').setInputFiles({
      name: 'kota.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('x'),
    });
    await vd.getByText(/Variabel dari kolom: \{\{kota\}\}, \{\{email\}\}/).waitFor();
    // Satu penerima tanpa kota: ditolak sebelum kirim, dengan alasan yang jelas.
    await vd.getByRole('alert').getByText('1 penerima tidak punya nilai untuk {{kota}}').waitFor();
    await vd.getByRole('checkbox', { name: /Saya konfirmasi/ }).check();
    assert.equal(await vd.getByRole('button', { name: 'Mulai kirim' }).isEnabled(), false);
    // Buang baris itu: pesan siap, contoh memakai data baris pertama.
    const vlist = vd.locator('#bc-list');
    await vlist.fill(
      (await vlist.inputValue())
        .split('\n')
        .filter((l) => !l.includes('081333333333'))
        .join('\n'),
    );
    await vd.getByText('Halo Budi dari Bandung').waitFor();
    await vd.getByRole('button', { name: 'Mulai kirim' }).click();
    await vd.waitFor({ state: 'hidden' });
    const sent = calls.create[calls.create.length - 1];
    assert.deepEqual(
      sent.recipients.map((r) => [r.phone, r.vars]),
      [
        ['081111111111', { kota: 'Bandung' }], // email tidak dipakai pesan, jadi tidak dikirim
        ['081222222222', { kota: 'Medan' }],
      ],
    );
    contactsAvailable = false;
    importMode = 'ok';

    // 7c. Lampiran: ditolak di klien bila terlalu besar, pesan server tampil, chip muncul, id ikut dikirim,
    // dan melepas lampiran membuat pengiriman tanpa attachmentId.
    contactsAvailable = false;
    const fillBasics = async (d) => {
      await d.getByLabel('Nama (hanya untuk Anda)').fill('Dengan lampiran');
      await d.getByLabel('Pesan', { exact: true }).fill('Halo {{nama}}, brosur terbaru');
      await d.locator('#bc-list').fill('Budi, 081111111111');
    };
    await page.getByRole('button', { name: /Kirim terjadwal baru/ }).click();
    const ad = page.getByRole('dialog');
    await ad.waitFor();
    await fillBasics(ad);
    await ad.locator('#bc-attachment').setInputFiles({
      name: 'besar.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(11 * 1024 * 1024, 1),
    });
    await ad
      .getByRole('alert')
      .getByText(/Berkas terlalu besar/)
      .waitFor();
    assert.equal(calls.attach, 0, 'berkas besar tidak diunggah');
    attachMode = 'error';
    await ad.locator('#bc-attachment').setInputFiles({
      name: 'gambar.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50]),
    });
    await ad
      .getByRole('alert')
      .getByText(/Hanya gambar JPEG atau PDF/)
      .waitFor();
    attachMode = 'ok';
    await ad.locator('#bc-attachment').setInputFiles({
      name: 'brosur.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7'),
    });
    await ad.getByText('brosur.pdf', { exact: true }).waitFor();
    await ad.getByText('(1,5 MB)').waitFor();
    await ad.getByRole('button', { name: 'Ganti lampiran' }).waitFor();
    await ad.getByRole('checkbox', { name: /Saya konfirmasi/ }).check();
    await ad.getByRole('button', { name: 'Mulai kirim' }).click();
    await ad.waitFor({ state: 'hidden' });
    assert.equal(calls.create[calls.create.length - 1].attachmentId, 'att-1');

    await page.getByRole('button', { name: /Kirim terjadwal baru/ }).click();
    const rd = page.getByRole('dialog');
    await rd.waitFor();
    await fillBasics(rd);
    await rd.locator('#bc-attachment').setInputFiles({
      name: 'brosur.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7'),
    });
    await rd.getByRole('button', { name: 'Hapus lampiran brosur.pdf' }).click();
    await rd.getByRole('button', { name: 'Lampirkan gambar atau PDF' }).waitFor();
    await rd.getByRole('checkbox', { name: /Saya konfirmasi/ }).check();
    await rd.getByRole('button', { name: 'Mulai kirim' }).click();
    await rd.waitFor({ state: 'hidden' });
    assert.equal('attachmentId' in calls.create[calls.create.length - 1], false);
    // Kartu pengiriman menampilkan lampiran yang dipakainya.
    await page.getByText('katalog.pdf', { exact: true }).waitFor();
    await page.getByText('(2,0 MB)').waitFor();

    // 8. Ponsel: tidak ada luapan horizontal, dan dialog tetap bisa dipakai tanpa mouse.
    await page.setViewportSize({ width: 375, height: 700 });
    await page.getByRole('button', { name: /Kirim terjadwal baru/ }).click();
    const mobile = page.getByRole('dialog');
    await mobile.waitFor();
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - window.innerWidth,
      dialog: (() => {
        const d = document.querySelector('[role="dialog"]');
        return d.scrollWidth - d.clientWidth;
      })(),
    }));
    assert.ok(overflow.page <= 0, `halaman meluap horizontal ${overflow.page}px`);
    assert.ok(overflow.dialog <= 0, `dialog meluap horizontal ${overflow.dialog}px`);
    await page.keyboard.press('Escape');
    await mobile.waitFor({ state: 'hidden' });

    // Satu-satunya error konsol yang diharapkan: dua respons 400 yang sengaja disimulasikan (import gagal, lampiran ditolak).
    const unexpected = errors.filter((e) => !/status of 400/.test(e));
    assert.deepEqual(unexpected, [], `error di konsol browser:\n${unexpected.join('\n')}`);
    assert.equal(errors.length - unexpected.length, 2, 'tepat dua 400 simulasi');
    console.log(
      'PASS: import CSV/Excel (append, error, empty), file variables (only used ones sent, missing values blocked), contacts download link, attachments (client size check, server error, chip, id sent, removable, card shows it), number check + remove unregistered, consent still required, report download, no mobile overflow, Escape closes, no console errors',
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
