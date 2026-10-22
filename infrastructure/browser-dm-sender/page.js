(() => {
  const visible = (element) => !!element && element.getClientRects().length > 0;
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const normalize = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
  const textOf = (element) => element.value ?? element.innerText ?? element.textContent;
  const username = (href) => {
    try {
      const url = new URL(href, location.href);
      return url.hostname === 'www.tiktok.com'
        ? /^\/@([a-z0-9._]{2,24})\/?$/i.exec(url.pathname)?.[1].toLowerCase()
        : null;
    } catch {
      return null;
    }
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const blocked = () =>
    !!document.querySelector('iframe[src*="captcha"], [id*="captcha"], [data-e2e="captcha"]');
  function senderMatches(expected) {
    const links = all(
      'a[data-e2e="nav-profile"], a[data-e2e="profile-icon"], a:has([data-e2e="profile-icon"]), nav a[aria-label="Profile" i], nav a[aria-label="Profil" i]',
    );
    return links.some((link) => username(link.href) === expected.toLowerCase());
  }
  function chatRoot(target) {
    // These new-layout markers come from the supplied TikTok DOM diagnostic.
    // Match the exact handle/header link, never a display name or sidebar entry.
    const roots = new Set(
      all(
        '[data-e2e="chat-uniqueid"], [class*="--DivChatHeader "], [data-e2e="chat-header"], [data-e2e="chat-title"], [data-e2e="chat-top"], [data-e2e="chat-nickname"], main header',
      )
        .filter(
          (header) =>
            normalize(header.textContent).toLowerCase() === `@${target}` ||
            all('a[href]', header).some((link) => username(link.href) === target),
        )
        .map((header) =>
          header.closest(
            '[data-e2e="dm-new-chatbox"], [data-e2e="chat-room"], [data-e2e="chat-box"], main',
          ),
        )
        .filter(Boolean),
    );
    return roots.size === 1 ? [...roots][0] : null;
  }
  function messageNodes(root, message) {
    const list = root.querySelector?.('[data-e2e="dm-new-message-list"]');
    if (!list)
      return all(
        '[data-e2e="chat-item"], [data-e2e="chat-message"], [data-e2e="message-item"]',
        root,
      ).filter((node) => normalize(textOf(node)) === normalize(message));
    // The diagnostic has a new message log. Count exact text occurrences, rather
    // than node identity: rerendering an old identical message is not a new send.
    return all('div, p, span', list).filter(
      (node) =>
        normalize(textOf(node)) === normalize(message) &&
        ![...node.children].some((child) => normalize(textOf(child)) === normalize(message)),
    );
  }
  function messagePending(node, root) {
    const list = root.querySelector?.('[data-e2e="dm-new-message-list"]');
    let container = node;
    if (list)
      while (container.parentElement && container.parentElement !== list)
        container = container.parentElement;
    return !!container.querySelector(
      '[data-e2e="send-error"], [data-e2e="send-failed"], [data-e2e="sending"], [aria-label="Failed to send" i]',
    );
  }
  async function awaitChat(delivery) {
    for (let i = 0; i < 25; i++) {
      if (blocked()) throw new Error('Verifikasi TikTok terdeteksi; selesaikan manual.');
      const root = chatRoot(delivery.username);
      if (root && senderMatches(delivery.senderUsername)) return root;
      await wait(500);
    }
    if (!senderMatches(delivery.senderUsername))
      throw new Error('Akun pengirim belum dapat diverifikasi dari navigasi profil TikTok.');
    throw new Error(
      `Chat aktif ${
        all('[data-e2e="chat-uniqueid"]')
          .map((element) => normalize(element.textContent))
          .join(', ') || 'belum dikenali'
      }, target @${delivery.username}. Penerima belum cocok/terverifikasi; tidak mengirim.`,
    );
  }
  globalThis.smgeDmPage = {
    async prepare(delivery) {
      try {
        await awaitChat(delivery);
        return { ready: true };
      } catch (error) {
        return { status: 'FAILED', detail: error.message };
      }
    },
    diagnose() {
      const describe = (element) => {
        const rect = element.getBoundingClientRect();
        const attr = (name) => (element.getAttribute(name) ?? '').slice(0, 160);
        return {
          tag: element.tagName,
          e2e: attr('data-e2e'),
          role: attr('role'),
          classes: attr('class'),
          editable: attr('contenteditable'),
          ...(element.matches('input, textarea, [contenteditable="true"]')
            ? { placeholder: attr('placeholder') || attr('data-placeholder') }
            : {}),
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      };
      const chain = (element) => {
        const parents = [];
        for (
          let parent = element.parentElement;
          parent && parents.length < 6;
          parent = parent.parentElement
        )
          parents.push(describe(parent));
        return parents;
      };
      // Copy structural attributes only, never HTML, arbitrary text, editor values,
      // cookies, storage, or network payloads.
      const elements = all(
        '[contenteditable="true"], textarea, input[placeholder], [role="textbox"], [data-e2e*="chat"], [data-e2e*="message"], [class*="ChatHead"], [class*="ChatTop"], [class*="ChatBox"], a[href*="/@"]',
      )
        .slice(0, 150)
        .map((element) => ({
          ...describe(element),
          ...(element.tagName === 'A' && username(element.href)
            ? { profileUsername: username(element.href) }
            : {}),
          parents: chain(element),
        }));
      const handles = all('a, span, p, div')
        .filter((element) => /^@[a-z0-9._]{2,24}$/i.test(normalize(element.textContent)))
        .slice(0, 30)
        .map((element) => ({
          ...describe(element),
          handle: normalize(element.textContent).toLowerCase(),
          parents: chain(element),
        }));
      return { format: 'smge-dm-diagnostic-v1', path: location.pathname, elements, handles };
    },
    async open(delivery) {
      if (blocked())
        return { status: 'FAILED', detail: 'Verifikasi TikTok terdeteksi; selesaikan manual.' };
      if (!senderMatches(delivery.senderUsername))
        return {
          status: 'FAILED',
          detail:
            'Akun login tidak dapat diverifikasi dari navigasi profil TikTok. Buka menu Profil akun pengirim.',
        };
      if (username(location.href) !== delivery.username)
        return { status: 'FAILED', detail: 'Profil penerima tidak cocok.' };
      const button = all('[data-e2e="message-button"], button, a[role="button"]').find(
        (element) =>
          element.matches('[data-e2e="message-button"]') ||
          /^(message|send message|pesan|kirim pesan)$/i.test(normalize(element.textContent)),
      );
      if (!button || button.disabled)
        return { status: 'FAILED', detail: 'Tombol Pesan tidak tersedia untuk penerima ini.' };
      button.click();
      return { opened: true };
    },
    async focus(delivery) {
      try {
        if (!delivery.attemptId) throw new Error('ID percobaan pengiriman tidak tersedia.');
        if (globalThis.__smgeDmStage?.attemptId === delivery.attemptId)
          throw new Error('Percobaan ini sudah pernah menyiapkan editor; tidak mengetik ulang.');
        const root = await awaitChat(delivery);
        const editors = all(
          '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-e2e="message-input"], textarea',
          root,
        );
        if (editors.length !== 1) throw new Error('Kolom pesan tidak dikenali dengan pasti.');
        const editor = editors[0];
        if (normalize(textOf(editor)))
          throw new Error('Kolom pesan sudah berisi draft; periksa manual.');
        editor.focus();
        if (document.activeElement && document.activeElement !== editor)
          throw new Error('Kolom pesan belum mendapat fokus.');
        globalThis.__smgeDmStage = {
          attemptId: delivery.attemptId,
          username: delivery.username,
          senderUsername: delivery.senderUsername,
          root,
          editor,
          beforeCount: messageNodes(root, delivery.message).length,
        };
        return { focused: true };
      } catch (error) {
        return { status: 'FAILED', detail: error.message };
      }
    },
    async inspect(delivery) {
      try {
        await wait(500);
        const state = globalThis.__smgeDmStage;
        if (
          !state ||
          state.attemptId !== delivery.attemptId ||
          state.username !== delivery.username ||
          state.senderUsername !== delivery.senderUsername
        )
          throw new Error('Persiapan input tidak cocok dengan percobaan aktif.');
        if (
          blocked() ||
          !senderMatches(delivery.senderUsername) ||
          chatRoot(delivery.username) !== state.root
        )
          throw new Error('Identitas chat berubah sebelum kirim.');
        const editor = state.editor;
        if (
          editor.isConnected === false ||
          (document.activeElement && document.activeElement !== editor)
        )
          throw new Error('Fokus kolom pesan berubah; tidak mengirim.');
        if (normalize(textOf(editor)) !== normalize(delivery.message))
          throw new Error('Template belum masuk dengan utuh ke editor TikTok. Tidak mengirim.');
        const buttons = all(
          '[data-e2e="message-send"], [data-e2e="send-message-button"], button[aria-label="Send"], button[aria-label="Kirim"]',
          state.root,
        );
        if (
          buttons.length === 1 &&
          !buttons[0].disabled &&
          buttons[0].getAttribute('aria-disabled') !== 'true'
        ) {
          const bounds = buttons[0].getBoundingClientRect();
          if (bounds.width <= 0 || bounds.height <= 0)
            throw new Error('Tombol kirim tidak terlihat.');
          return {
            ready: true,
            action: {
              kind: 'click',
              x: bounds.x + bounds.width / 2,
              y: bounds.y + bounds.height / 2,
            },
          };
        }
        if (
          !buttons.length &&
          editor.closest?.('[data-e2e="dm-new-input-editor"]') &&
          editor.classList.contains('public-DraftEditor-content')
        )
          return { ready: true, action: { kind: 'enter' } };
        throw new Error(
          'Kontrol kirim tidak dikenali atau tidak aktif. Template masih berupa draft.',
        );
      } catch (error) {
        return { status: 'FAILED', detail: error.message };
      }
    },
    async observe(delivery) {
      try {
        const state = globalThis.__smgeDmStage;
        if (!state || state.attemptId !== delivery.attemptId)
          throw new Error('Percobaan pengiriman berubah; periksa chat TikTok.');
        for (let i = 0; i < 12; i++) {
          await wait(500);
          if (
            blocked() ||
            chatRoot(delivery.username) !== state.root ||
            !senderMatches(delivery.senderUsername)
          )
            break;
          const current = messageNodes(state.root, delivery.message);
          const item = current.length > state.beforeCount ? current[current.length - 1] : null;
          if (item && !messagePending(item, state.root) && !normalize(textOf(state.editor))) {
            await wait(2000);
            if (
              chatRoot(delivery.username) === state.root &&
              item.isConnected &&
              messageNodes(state.root, delivery.message).length > state.beforeCount &&
              !messagePending(item, state.root)
            )
              return {
                status: 'SENT',
                detail:
                  'Pesan baru terlihat pada chat penerima setelah input browser; bukan bukti dibaca atau konfirmasi API.',
              };
          }
        }
        return {
          status: 'UNVERIFIED',
          detail:
            'Input kirim sudah dicoba, tetapi pesan baru belum terverifikasi. Periksa chat TikTok; jangan kirim ulang otomatis.',
        };
      } catch (error) {
        return { status: 'UNVERIFIED', detail: error.message };
      }
    },
  };
})();
