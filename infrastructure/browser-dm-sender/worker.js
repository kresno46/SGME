if (typeof globalThis.importScripts === 'function') globalThis.importScripts('native-input.js');
let working = false;
const ALARM = 'smge-dm-next';
async function save(job) {
  await chrome.storage.local.set({ job });
}
async function api(job, path, body) {
  const tab = await chrome.tabs.get(job.dashboardTabId);
  if (new URL(tab.url).origin !== job.origin) throw new Error('Tab dashboard berubah alamat.');
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
    if (tab.status === 'complete' && tab.url.startsWith(url)) return;
  }
  throw new Error('Halaman TikTok tidak selesai dimuat.');
}
const chatFrames = new Map();
async function page(tabId, method, delivery) {
  const key = `${tabId}:${delivery.attemptId}`;
  if (method === 'open') chatFrames.clear();
  const tab = await chrome.tabs.get(tabId);
  const businessSuite =
    new URL(tab.url).pathname.replace(/\/+$/, '') === '/business-suite/messages';
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
        'Tidak ada tugas dalam antrean. Di Outbound, setujui tugas lalu klik Antrekan tugas disetujui sebelum Mulai.';
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
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const opened = await page(job.tiktokTabId, 'open', delivery);
      if (!opened.opened) outcome = opened;
      else {
        await new Promise((resolve) => setTimeout(resolve, 2500));
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
    job.active = !!latest.active && outcome.status === 'SENT';
    job.detail = `@${delivery.username}: ${outcome.status}. ${outcome.detail}`;
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
