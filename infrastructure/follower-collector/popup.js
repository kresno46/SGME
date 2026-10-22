let tabId;
let pending = false;
let lastError = '';
let lastCount = 0;
const status = document.getElementById('status');
const start = document.getElementById('start');
const stop = document.getElementById('stop');
const exportButton = document.getElementById('export');
start.disabled = stop.disabled = exportButton.disabled = true;

async function command(action) {
  return chrome.tabs.sendMessage(tabId, { source: 'smge-collector', action });
}

function render(state) {
  lastCount = state.count;
  status.textContent = `${state.accountUsername ? '@' + state.accountUsername + ' · ' : ''}${state.count} username. ${lastError || state.reason}`;
  start.textContent = state.count ? 'Mulai ulang' : 'Mulai';
  start.disabled = state.running || pending;
  stop.disabled = !state.running || pending;
  exportButton.disabled = state.running || !state.count || pending;
}

async function perform(action) {
  if (pending) return;
  if (action === 'start' && !document.getElementById('confirmed').checked) {
    lastError = 'Centang konfirmasi daftar followers terlebih dahulu.';
    status.textContent = 'Centang konfirmasi daftar followers terlebih dahulu.';
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
  start.disabled = stop.disabled = exportButton.disabled = true;
  try {
    const response = await command(action);
    if (response.error) throw new Error(response.error);
    if (action === 'export') {
      const blob = new Blob([JSON.stringify(response.batch, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `smge-followers-${response.batch.accountUsername}-${Date.now()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    pending = false;
    render(await command('status'));
  } catch (error) {
    lastError = error.message;
    status.textContent = error.message;
    pending = false;
    // Keep recovery possible after a missing/closed followers dialog.
    start.disabled = false;
    try {
      render(await command('status'));
      status.textContent = error.message;
    } catch {
      /* Tab navigated. Reopen popup on TikTok. */
    }
  }
}

start.addEventListener('click', () => void perform('start'));
stop.addEventListener('click', () => void perform('stop'));
exportButton.addEventListener('click', () => void perform('export'));

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(www\.)?tiktok\.com\/@[^/?#]+/.test(tab.url ?? '')) {
    throw new Error('Buka halaman profil https://www.tiktok.com/@username terlebih dahulu.');
  }
  tabId = tab.id;
  await chrome.scripting.executeScript({ target: { tabId }, files: ['collector.js'] });
  render(await command('status'));
  setInterval(async () => {
    if (pending) return;
    try {
      render(await command('status'));
    } catch {
      status.textContent = 'Tab berubah. Buka ulang popup di profil TikTok.';
      start.disabled = stop.disabled = exportButton.disabled = true;
    }
  }, 1000);
}
void initialize().catch((error) => {
  status.textContent = error.message;
});
