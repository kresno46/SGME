if (typeof globalThis.importScripts === 'function') globalThis.importScripts('native-input.js');
let working = false;
const ALARM = 'smge-dm-next';
function tabAddress(tab) {
  // Chrome can expose only pendingUrl while a newly created tab is navigating.
  // pendingUrl is not evidence of a loaded document and must never be trusted for sending.
  if (typeof tab?.url !== 'string' || !tab.url.trim() || tab.url === 'about:blank') return null;
  try {
    return new URL(tab.url);
  } catch {
    throw new Error('Alamat tab tidak dapat dibaca. Muat ulang tab TikTok dan extension.');
  }
}
async function save(job) {
  await chrome.storage.local.set({ job });
}
async function api(job, path, body) {
  const tab = await chrome.tabs.get(job.dashboardTabId);
  if (tabAddress(tab)?.origin !== job.origin)
    throw new Error('Tab dashboard belum siap atau berubah alamat.');
  const [response] = await chrome.scripting.executeScript({
    target: { tabId: job.dashboardTabId },
    func: async (path, body) => {
      const request = (url, payload) => {
        // Read again after refresh: the CSRF cookie can rotate with the session.
        const csrf = document.cookie
          .split('; ')
          .find((part) => part.startsWith('smge_csrf='))
          ?.slice('smge_csrf='.length);
        return fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': decodeURIComponent(csrf ?? ''),
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
      };
      try {
        let result = await request('/api/outbound/browser-dm/' + path, body);
        if (result.status === 401) {
          const refreshed = await request('/api/auth/refresh');
          if (!refreshed.ok)
            return {
              ok: false,
              status: 401,
              data: { message: 'Sesi dashboard berakhir. Login ulang SMGE, lalu Mulai lagi.' },
            };
          result = await request('/api/outbound/browser-dm/' + path, body);
        }
        // Nest sends an empty successful body when no delivery can be claimed.
        // Calling json() on it throws and previously produced a misleading login error.
        const text = await result.text();
        let data = null;
        if (text.trim()) {
          try {
            data = JSON.parse(text);
          } catch {
            return {
              ok: false,
              status: result.status,
              data: {
                message: `Respons dashboard bukan JSON (HTTP ${result.status}). Muat ulang dashboard dan periksa API.`,
              },
            };
          }
        }
        return { ok: result.ok, status: result.status, data };
      } catch {
        return {
          ok: false,
          status: 0,
          data: {
            message:
              'Koneksi API dashboard gagal. Pastikan tab SMGE dan server API tetap berjalan.',
          },
        };
      }
    },
    args: [path, body],
  });
  if (!response?.result)
    throw new Error(
      'Extension tidak menerima hasil dari tab dashboard. Muat ulang tab dan extension, lalu coba lagi.',
    );
  if (!response.result.ok) {
    const error = new Error(
      response.result.data?.message ??
        `Permintaan dashboard gagal (HTTP ${response.result.status ?? 'tidak diketahui'}).`,
    );
    error.status = response.result.status ?? response.result.data?.statusCode;
    throw error;
  }
  return response.result.data;
}
async function navigate(tabId, url) {
  await chrome.tabs.update(tabId, { url, active: true });
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && typeof tab.url === 'string' && tab.url.startsWith(url)) return;
  }
  throw new Error('Halaman TikTok tidak selesai dimuat.');
}
const chatFrames = new Map();
let senderProbeTabId = null;
async function verifyBusinessSender(delivery) {
  // This reads the logged-in account from public navigation, not from the URL of
  // the visited profile. Keep this tab in the background so chat focus is preserved.
  const url = `https://www.tiktok.com/@${delivery.senderUsername}`;
  if (senderProbeTabId === null) {
    senderProbeTabId = (await chrome.tabs.create({ url, active: false })).id;
  } else {
    await chrome.tabs.reload(senderProbeTabId);
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const tab = await chrome.tabs.get(senderProbeTabId);
    if (tab.status !== 'complete') continue;
    const parsed = tabAddress(tab);
    if (!parsed) continue;
    if (parsed.origin !== 'https://www.tiktok.com')
      throw new Error('Tab verifikasi pengirim berubah alamat.');
    if (parsed.pathname !== `/@${delivery.senderUsername}`) continue;
    await chrome.scripting.executeScript({
      target: { tabId: senderProbeTabId },
      files: ['page.js'],
    });
    const [response] = await chrome.scripting.executeScript({
      target: { tabId: senderProbeTabId },
      func: () => globalThis.smgeDmPage.identifySender(),
      args: [],
    });
    if (response?.result?.blocked)
      throw new Error('Verifikasi TikTok terdeteksi pada akun pengirim. Selesaikan manual.');
    const actual = response?.result?.username;
    if (!actual) continue;
    if (actual !== delivery.senderUsername.toLowerCase())
      throw new Error(
        `Akun TikTok login @${actual} berbeda dengan pengirim @${delivery.senderUsername}. Tidak mengirim.`,
      );
    return { username: actual, attemptId: delivery.attemptId, verifiedAt: Date.now() };
  }
  throw new Error(
    'Tab verifikasi pengirim belum siap atau identitas belum terbaca. Pastikan login TikTok dan izin akses extension ke www.tiktok.com aktif.',
  );
}
async function page(tabId, method, delivery) {
  const key = `${tabId}:${delivery.attemptId}`;
  if (method === 'open') chatFrames.clear();
  let address;
  for (let i = 0; i < 30; i++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') address = tabAddress(tab);
    if (address) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!address || address.origin !== 'https://www.tiktok.com')
    throw new Error('Tab chat TikTok belum siap atau berubah alamat. Tidak mengirim.');
  const businessSuite = address.pathname.replace(/\/+$/, '') === '/business-suite/messages';
  if (method === 'prepare' && businessSuite) {
    chatFrames.delete(key);
    for (let i = 0; i < 25; i++) {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['page.js'],
      });
      const candidates = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: (delivery) => globalThis.smgeDmPage.locate(delivery),
        args: [delivery],
      });
      const matches = candidates.filter(
        (item) =>
          item.frameId > 0 &&
          item.documentId &&
          item.result?.path === '/messages' &&
          item.result.chat,
      );
      if (matches.length > 1) throw new Error('Lebih dari satu iframe chat cocok. Tidak mengirim.');
      if (matches.length === 1) {
        chatFrames.set(key, { documentIds: [matches[0].documentId] });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!chatFrames.has(key))
      throw new Error('Chat penerima belum dikenali dalam iframe Business Suite. Tidak mengirim.');
  }
  if (businessSuite && method !== 'open' && !chatFrames.has(key))
    throw new Error('Dokumen iframe chat berubah; periksa hasil sebelum mencoba lagi.');
  const target = { tabId, ...(chatFrames.get(key) ?? {}) };
  if (businessSuite && method !== 'open') {
    const senderVerification = await verifyBusinessSender(delivery);
    delivery = { ...delivery, senderVerification };
  }
  await chrome.scripting.executeScript({ target, files: ['page.js'] });
  const [response] = await chrome.scripting.executeScript({
    target,
    func: (method, delivery) => globalThis.smgeDmPage[method](delivery),
    args: [method, delivery],
  });
  if (!response?.result) throw new Error('Halaman TikTok berubah saat diproses.');
  return response.result;
}
async function step() {
  if (working) return;
  working = true;
  let job;
  try {
    job = (await chrome.storage.local.get('job')).job;
    if (!job) return;
    if (job.current) {
      // Restart/report retry: report only; never click Send a second time.
      const outcome = job.pendingReport ?? {
        status: 'UNVERIFIED',
        detail: 'Extension terputus saat percobaan; periksa chat TikTok sebelum melanjutkan.',
      };
      await api(job, `${job.current.id}/result`, {
        clientId: job.clientId,
        attemptId: job.current.attemptId,
        ...outcome,
      });
      job.current = null;
      job.pendingReport = null;
      job.active = false;
      job.detail = 'Percobaan sebelumnya dicatat. Periksa dashboard sebelum memulai lagi.';
      await save(job);
      return;
    }
    if (!job.active) return;
    const delivery = await api(job, 'claim', { accountId: job.accountId, clientId: job.clientId });
    if (!delivery) {
      job.active = false;
      job.detail =
        'Tidak ada tugas dalam antrean. Di Outbound, pilih penerima dan pesan melalui Kirim DM, lalu klik Masukkan ke antrean sebelum Mulai.';
      await save(job);
      return;
    }
    if (delivery.skipped) {
      job.detail = 'Satu tugas tidak lagi memenuhi syarat; dilewati.';
      await save(job);
      return;
    }
    job.current = { id: delivery.id, attemptId: delivery.attemptId };
    job.detail = `Memproses @${delivery.username} dari @${delivery.senderUsername}.`;
    await save(job);
    let outcome;
    let sendStage = false;
    try {
      if (!job.tiktokTabId) {
        const tab = await chrome.tabs.create({ url: 'https://www.tiktok.com/', active: true });
        job.tiktokTabId = tab.id;
        await save(job);
      }
      await navigate(job.tiktokTabId, `https://www.tiktok.com/@${delivery.username}`);
      const opened = await page(job.tiktokTabId, 'open', delivery);
      if (!opened.opened) outcome = opened;
      else {
        const prepared = await page(job.tiktokTabId, 'prepare', delivery);
        if (!prepared.ready) {
          outcome = prepared;
        } else {
          const latest = (await chrome.storage.local.get('job')).job;
          if (!latest.active) throw new Error('Dihentikan operator sebelum kirim.');
          sendStage = true;
          outcome = await globalThis.smgeNativeInput({
            tabId: job.tiktokTabId,
            delivery,
            page: (method, item) => page(job.tiktokTabId, method, item),
            authorize: () =>
              api(job, `${delivery.id}/authorize`, {
                clientId: job.clientId,
                attemptId: delivery.attemptId,
              }),
            isActive: async () => !!(await chrome.storage.local.get('job')).job?.active,
          });
        }
      }
    } catch (error) {
      outcome = { status: sendStage ? 'UNVERIFIED' : 'FAILED', detail: error.message };
    }
    job.active = !!(await chrome.storage.local.get('job')).job?.active;
    job.pendingReport = outcome;
    await save(job);
    await api(job, `${delivery.id}/result`, {
      clientId: job.clientId,
      attemptId: delivery.attemptId,
      ...outcome,
    });
    const latest = (await chrome.storage.local.get('job')).job;
    job.active = !!latest.active && ['SENT', 'FAILED'].includes(outcome.status);
    job.detail = `@${delivery.username}: ${outcome.status}. ${outcome.detail}${
      job.active && outcome.status === 'FAILED'
        ? ' Penerima ini dilewati; antrean berikutnya dilanjutkan pada putaran berikutnya.'
        : ''
    }`;
    job.current = null;
    job.pendingReport = null;
    await save(job);
  } catch (error) {
    if (job) {
      job.active = false;
      job.detail = error.message;
      if (error.status === 409) {
        job.current = null;
        job.pendingReport = null;
      }
      await save(job);
    }
  } finally {
    if (senderProbeTabId !== null) {
      const probeId = senderProbeTabId;
      senderProbeTabId = null;
      try {
        await chrome.tabs.remove(probeId);
      } catch {
        /* Already closed by the operator. */
      }
    }
    working = false;
  }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void step();
});
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  (async () => {
    const old = (await chrome.storage.local.get('job')).job;
    if (message.action === 'status') return old ?? { active: false, detail: 'Belum dimulai.' };
    if (message.action === 'stop') {
      if (old) {
        old.active = false;
        old.detail = 'Berhenti setelah percobaan aktif selesai; antrean tersisa tetap tersimpan.';
        await save(old);
      }
      return { ok: true };
    }
    if (message.action === 'start') {
      if (old?.active || working || old?.current)
        throw new Error(
          'Masih ada percobaan aktif/belum dilaporkan. Periksa dashboard atau tunggu pencatatan hasil.',
        );
      const job = {
        dashboardTabId: message.dashboardTabId,
        origin: message.origin,
        accountId: message.accountId,
        clientId: old?.clientId ?? crypto.randomUUID(),
        active: true,
        detail: 'Memulai antrean…',
      };
      await save(job);
      await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
      void step();
      return { ok: true };
    }
    return { error: 'Perintah tidak dikenal.' };
  })().then(respond, (error) => respond({ error: error.message }));
  return true;
});
