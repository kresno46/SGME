const statusElement = document.getElementById('status');
const startButton = document.getElementById('start');
let localNotice = '';
document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;
async function refresh() {
  const state = await chrome.runtime.sendMessage({ action: 'status' });
  statusElement.textContent = localNotice || state?.detail || 'Belum dimulai.';
  startButton.disabled = !!state?.active;
}
startButton.addEventListener('click', async () => {
  localNotice = '';
  try {
    if (!document.getElementById('confirm').checked)
      throw new Error('Centang persetujuan pengiriman terlebih dahulu.');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    const accountId = url.searchParams.get('account');
    if (url.pathname !== '/outbound' || !/^[a-f0-9-]{36}$/i.test(accountId ?? ''))
      throw new Error('Pilih akun melalui dropdown di tab Outbound SMGE terlebih dahulu.');
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('Alamat dashboard tidak valid.');
    const allowed = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!allowed) throw new Error('Izin untuk tab dashboard belum diberikan.');
    const result = await chrome.runtime.sendMessage({
      action: 'start',
      dashboardTabId: tab.id,
      origin: url.origin,
      accountId,
    });
    if (result.error) throw new Error(result.error);
    await refresh();
  } catch (error) {
    localNotice = error.message;
    statusElement.textContent = error.message;
  }
});
document.getElementById('stop').addEventListener('click', async () => {
  localNotice = '';
  await chrome.runtime.sendMessage({ action: 'stop' });
  await refresh();
});
document.getElementById('diagnose').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (new URL(tab.url).origin !== 'https://www.tiktok.com')
      throw new Error('Buka tab chat TikTok yang gagal, lalu klik Diagnostik dari tab tersebut.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page.js'] });
    const [response] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.smgeDmPage.diagnose(),
    });
    if (!response?.result)
      throw new Error('Struktur chat belum dapat dibaca. Muat ulang extension dan coba lagi.');
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(response.result, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `smge-dm-diagnostic-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    localNotice =
      'Diagnostik berhasil diunduh. File berisi struktur elemen dan username profil, tanpa isi pesan, cookie, atau token.';
  } catch (error) {
    localNotice = error.message;
  }
  statusElement.textContent = localNotice;
});
void refresh();
setInterval(() => void refresh(), 1500);
