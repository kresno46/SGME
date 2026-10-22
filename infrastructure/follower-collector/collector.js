(() => {
  if (globalThis.__smgeFollowerCollector) return;
  globalThis.__smgeFollowerCollector = true;
  const LIMIT = 250;
  let rows = new Map();
  let accountUsername = '';
  let collectedAt = '';
  let reason = 'Belum dimulai.';
  let running = false;
  let timer;
  let root;
  let idleTicks = 0;
  let ticks = 0;

  function usernameFromUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== 'https:' || !['www.tiktok.com', 'tiktok.com'].includes(url.hostname))
        return null;
      const match = /^\/@([a-z0-9._]{2,24})\/?$/i.exec(url.pathname);
      return match ? match[1].toLowerCase() : null;
    } catch {
      return null;
    }
  }

  function stop(message) {
    running = false;
    reason = message;
    clearTimeout(timer);
  }

  function visible(element) {
    return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  }

  function findDialog() {
    return [...document.querySelectorAll('[role="dialog"], [data-e2e="follow-info-popup"]')].find(
      (element) => visible(element) && element.querySelector('a[href*="/@"]'),
    );
  }

  function tick() {
    try {
      collectTick();
    } catch {
      stop('Struktur daftar berubah atau gagal dibaca; hasil parsial dapat diekspor.');
    }
  }

  function collectTick() {
    if (!running) return;
    if (usernameFromUrl(location.href) !== accountUsername) {
      stop('Profil berubah; hasil parsial disimpan.');
      return;
    }
    if (!root?.isConnected || !visible(root)) {
      stop('Daftar ditutup; hasil parsial disimpan.');
      return;
    }
    if (document.querySelector('iframe[src*="captcha"], [id*="captcha"], [data-e2e="captcha"]')) {
      stop('Verifikasi terdeteksi. Selesaikan manual; hasil parsial dapat diekspor.');
      return;
    }
    const before = rows.size;
    for (const anchor of root.querySelectorAll('a[href]')) {
      if (!visible(anchor)) continue;
      const username = usernameFromUrl(anchor.href);
      if (!username || username === accountUsername || rows.has(username)) continue;
      // Prefer the displayed title; never scrape unrelated text from the page.
      const displayName = (anchor.getAttribute('title') || anchor.textContent || '')
        .trim()
        .slice(0, 80);
      rows.set(username, { username, ...(displayName ? { displayName } : {}) });
      if (rows.size >= LIMIT) {
        stop('Batas 250 tercapai; hasil parsial, bukan seluruh followers.');
        return;
      }
    }
    idleTicks = before === rows.size ? idleTicks + 1 : 0;
    ticks++;
    if (idleTicks >= 5) {
      stop('Tidak ada username baru selama 10 detik; hasil mungkin parsial.');
      return;
    }
    if (ticks >= 150) {
      stop('Batas waktu 5 menit tercapai; hasil parsial disimpan.');
      return;
    }
    const scrollable = [root, ...root.querySelectorAll('*')]
      .filter(
        (element) =>
          element.scrollHeight > element.clientHeight + 10 &&
          ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
      )
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!scrollable) {
      stop('Area gulir tidak ditemukan. Ekspor hasil yang tampil atau buka ulang daftar.');
      return;
    }
    scrollable.scrollBy({
      top: Math.max(200, Math.round(scrollable.clientHeight * 0.8)),
      behavior: 'instant',
    });
    reason = 'Mengambil daftar yang tampil…';
    timer = setTimeout(tick, 2000);
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.source !== 'smge-collector') return;
    try {
      if (message.action === 'start') {
        if (running) throw new Error('Pengambilan sedang berjalan.');
        const username = usernameFromUrl(location.href);
        if (!username) throw new Error('Buka halaman profil TikTok sumber.');
        const dialog = findDialog();
        if (!dialog)
          throw new Error(
            'Daftar followers belum ditemukan. Buka Followers / Pengikut lalu coba lagi.',
          );
        // Prevent collecting Following when its tab is explicitly selected.
        const selected = dialog.querySelector('[role="tab"][aria-selected="true"]');
        if (
          selected &&
          /following|mengikuti/i.test(selected.textContent) &&
          !/followers|pengikut/i.test(selected.textContent)
        ) {
          throw new Error('Tab Following / Mengikuti terbuka. Pilih Followers / Pengikut.');
        }
        rows = new Map();
        root = dialog;
        accountUsername = username;
        collectedAt = new Date().toISOString();
        idleTicks = 0;
        ticks = 0;
        running = true;
        tick();
      }
      if (message.action === 'stop') stop('Dihentikan operator; hasil parsial disimpan.');
      if (message.action === 'export') {
        if (running) throw new Error('Hentikan pengambilan sebelum ekspor.');
        if (!rows.size) throw new Error('Belum ada username untuk diekspor.');
        respond({
          batch: {
            format: 'smge-followers-v1',
            accountUsername,
            collectedAt,
            stopReason: reason,
            followers: [...rows.values()],
          },
        });
        return;
      }
      respond({ running, accountUsername, count: rows.size, reason });
    } catch (error) {
      respond({ error: error.message });
    }
  });
})();
