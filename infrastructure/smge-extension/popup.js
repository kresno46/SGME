const $ = (id) => document.getElementById(id);
const footer = $('status');
const TITLES = {
  home: 'Toolkit',
  collector: 'Ambil followers',
  sender: 'Kirim DM',
  diagnostic: 'Diagnostik chat',
};
const INITIAL = {
  home: 'Pilih alat untuk memulai.',
  collector: 'Menghubungkan ke tab…',
  sender: 'Memuat…',
  diagnostic: 'Siap.',
};
let current = 'home';
// Naik tiap pindah layar: hasil asinkron dari layar sebelumnya tidak boleh menimpa layar baru.
let epoch = 0;
let timer = null;

function say(text, error = false) {
  footer.textContent = text;
  footer.classList.toggle('error', error);
}
function poll(fn, ms) {
  clearInterval(timer);
  timer = setInterval(() => void fn().catch(() => undefined), ms);
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function download(name, data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------------------------------------------------------------- Ambil followers */
const collector = (() => {
  let tabId;
  let pending = false;
  let lastError = '';
  let lastCount = 0;
  const start = $('c-start');
  const stop = $('c-stop');
  const exportButton = $('c-export');
  const lock = () => (start.disabled = stop.disabled = exportButton.disabled = true);
  const command = (action) => chrome.tabs.sendMessage(tabId, { source: 'smge-collector', action });

  function render(state) {
    lastCount = state.count;
    say(
      `${state.accountUsername ? '@' + state.accountUsername + ' · ' : ''}${state.count} username. ${lastError || state.reason}`,
      !!lastError,
    );
    start.textContent = state.count ? 'Mulai ulang' : 'Mulai';
    start.disabled = state.running || pending;
    stop.disabled = !state.running || pending;
    exportButton.disabled = state.running || !state.count || pending;
  }

  async function perform(action) {
    if (pending) return;
    if (action === 'start' && !$('c-confirm').checked) {
      lastError = 'Centang konfirmasi daftar followers terlebih dahulu.';
      say(lastError, true);
      return;
    }
    if (
      action === 'start' &&
      lastCount &&
      !confirm('Mulai ulang menghapus hasil sementara. Sudah ekspor JSON hasil sebelumnya?')
    )
      return;
    lastError = '';
    pending = true;
    lock();
    try {
      const response = await command(action);
      if (response.error) throw new Error(response.error);
      if (action === 'export')
        download(
          `smge-followers-${response.batch.accountUsername}-${Date.now()}.json`,
          response.batch,
        );
      pending = false;
      render(await command('status'));
    } catch (error) {
      lastError = error.message;
      say(error.message, true);
      pending = false;
      // Pemulihan tetap mungkin setelah dialog followers tertutup atau tidak ditemukan.
      start.disabled = false;
      try {
        render(await command('status'));
        say(error.message, true);
      } catch {
        /* Tab berpindah. Buka ulang popup di TikTok. */
      }
    }
  }

  start.addEventListener('click', () => void perform('start'));
  stop.addEventListener('click', () => void perform('stop'));
  exportButton.addEventListener('click', () => void perform('export'));

  async function enter() {
    lock();
    const mine = epoch;
    try {
      const tab = await activeTab();
      if (!tab?.id || !/^https:\/\/(www\.)?tiktok\.com\/@[^/?#]+/.test(tab.url ?? ''))
        throw new Error('Buka halaman profil https://www.tiktok.com/@username terlebih dahulu.');
      tabId = tab.id;
      await chrome.scripting.executeScript({ target: { tabId }, files: ['collector.js'] });
      if (mine !== epoch) return;
      render(await command('status'));
      poll(async () => {
        if (pending) return;
        try {
          render(await command('status'));
        } catch {
          say('Tab berubah. Buka ulang popup di profil TikTok.', true);
          lock();
        }
      }, 1000);
    } catch (error) {
      if (mine === epoch) say(error.message, true);
    }
  }
  return { enter };
})();

/* ---------------------------------------------------------------- Kirim DM */
const sender = (() => {
  let notice = '';
  const startButton = $('s-start');
  const tileState = $('tile-sender-state');

  async function status() {
    const state = await chrome.runtime.sendMessage({ action: 'status' });
    tileState.textContent = state?.active ? 'Berjalan' : 'Antrean SMGE';
    tileState.classList.toggle('active', !!state?.active);
    return state;
  }
  async function refresh() {
    const state = await status();
    if (current === 'sender') say(notice || state?.detail || 'Belum dimulai.', !!notice);
    startButton.disabled = !!state?.active;
  }

  startButton.addEventListener('click', async () => {
    notice = '';
    try {
      if (!$('s-confirm').checked)
        throw new Error('Centang persetujuan pengiriman terlebih dahulu.');
      const tab = await activeTab();
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
      notice = error.message;
      say(error.message, true);
    }
  });
  $('s-stop').addEventListener('click', async () => {
    notice = '';
    await chrome.runtime.sendMessage({ action: 'stop' });
    await refresh();
  });

  return {
    status,
    enter: () => {
      void refresh();
      poll(refresh, 1500);
    },
  };
})();

/* ---------------------------------------------------------------- Diagnostik chat */
$('d-run').addEventListener('click', async () => {
  try {
    const tab = await activeTab();
    if (new URL(tab.url).origin !== 'https://www.tiktok.com')
      throw new Error('Buka tab chat TikTok yang gagal, lalu klik Diagnostik dari tab tersebut.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page.js'] });
    const [response] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.smgeDmPage.diagnose(),
    });
    if (!response?.result)
      throw new Error('Struktur chat belum dapat dibaca. Muat ulang extension dan coba lagi.');
    download(`smge-dm-diagnostic-${Date.now()}.json`, response.result);
    say(
      'Diagnostik berhasil diunduh. File berisi struktur elemen dan username profil, tanpa isi pesan, cookie, atau token.',
    );
  } catch (error) {
    say(error.message, true);
  }
});

/* ---------------------------------------------------------------- Navigasi */
function show(view, { focus = true } = {}) {
  current = view;
  epoch++;
  clearInterval(timer);
  for (const name of Object.keys(TITLES)) $(`view-${name}`).hidden = name !== view;
  $('back').hidden = view === 'home';
  $('title').textContent = TITLES[view];
  say(INITIAL[view]);
  if (focus) $(`${view}-h`).focus();
  if (view === 'collector') void collector.enter();
  else if (view === 'sender') sender.enter();
  else if (view === 'home') {
    // Ubin Kirim DM menampilkan apakah antrean sedang berjalan.
    void sender.status().catch(() => undefined);
    poll(sender.status, 2000);
  }
}

document
  .querySelectorAll('.tile')
  .forEach((tile) => tile.addEventListener('click', () => show(tile.dataset.view)));
$('back').addEventListener('click', () => show('home'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && current !== 'home') show('home');
});
$('version').textContent = `v${chrome.runtime.getManifest().version}`;
show('home', { focus: false });
