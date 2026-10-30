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
  const senderSelector =
    'a[data-e2e="nav-profile"], a[data-e2e="profile-icon"], a:has([data-e2e="profile-icon"]), nav a[aria-label="Profile" i], nav a[aria-label="Profil" i]';
  function senderMatches(expected, delivery) {
    let current = typeof window === 'undefined' ? null : window;
    let doc = document;
    for (let depth = 0; depth < 8; depth++) {
      const identities = [
        ...new Set(
          all(senderSelector, doc)
            .map((link) => username(link.href))
            .filter(Boolean),
        ),
      ];
      if (identities.length)
        return identities.length === 1 && identities[0] === expected.toLowerCase();
      if (!current || current === current.top) break;
      try {
        if (current.parent.location.origin !== 'https://www.tiktok.com') break;
        current = current.parent;
        doc = current.document;
      } catch {
        break;
      }
    }
    // Only the extension worker supplies this short-lived observation from a fresh
    // public TikTok profile page. Never infer the login from a recipient/profile URL.
    const proof = delivery?.senderVerification;
    try {
      const age = Date.now() - proof?.verifiedAt;
      return (
        !!proof &&
        typeof window !== 'undefined' &&
        window !== window.top &&
        location.origin === 'https://www.tiktok.com' &&
        location.pathname === '/messages' &&
        window.top.location.origin === 'https://www.tiktok.com' &&
        window.top.location.pathname.replace(/\/+$/, '') === '/business-suite/messages' &&
        proof.username === expected.toLowerCase() &&
        proof.attemptId === delivery.attemptId &&
        age >= 0 &&
        age <= 20000
      );
    } catch {
      return false;
    }
  }
  function frameVisible() {
    if (typeof window === 'undefined') return true;
    let current = window;
    try {
      for (let depth = 0; current !== current.top && depth < 8; depth++) {
        if (
          current.parent.location.origin !== 'https://www.tiktok.com' ||
          !visible(current.frameElement)
        )
          return false;
        const rect = current.frameElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        current = current.parent;
      }
      return current === current.top;
    } catch {
      return false;
    }
  }
  function clickPoint(button) {
    const bounds = button.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) throw new Error('Tombol kirim tidak terlihat.');
    let x = bounds.x + bounds.width / 2;
    let y = bounds.y + bounds.height / 2;
    if (typeof window !== 'undefined') {
      let current = window;
      for (let depth = 0; current !== current.top && depth < 8; depth++) {
        const frame = current.frameElement;
        if (!frame || current.parent.location.origin !== 'https://www.tiktok.com')
          throw new Error('Frame chat tidak dapat diverifikasi.');
        const rect = frame.getBoundingClientRect();
        if (
          !visible(frame) ||
          current.parent.getComputedStyle(frame).transform !== 'none' ||
          Math.abs(rect.width - frame.offsetWidth) > 1 ||
          Math.abs(rect.height - frame.offsetHeight) > 1
        )
          throw new Error('Posisi iframe berubah atau memakai transformasi. Tidak mengirim.');
        if (x < 0 || y < 0 || x >= current.innerWidth || y >= current.innerHeight)
          throw new Error('Tombol kirim di luar area iframe.');
        x += rect.x + frame.clientLeft;
        y += rect.y + frame.clientTop;
        current = current.parent;
      }
      if (
        current !== current.top ||
        x < 0 ||
        y < 0 ||
        x >= current.innerWidth ||
        y >= current.innerHeight
      )
        throw new Error('Tombol kirim di luar area halaman.');
    }
    return { x, y };
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
  function chatEditors(root) {
    return all(
      '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-e2e="message-input"], textarea',
      root,
    );
  }
  function editorEnabled(editor) {
    return (
      !editor.disabled &&
      !editor.readOnly &&
      !editor.hasAttribute?.('disabled') &&
      !editor.hasAttribute?.('readonly') &&
      editor.getAttribute?.('aria-disabled') !== 'true' &&
      editor.getAttribute?.('aria-readonly') !== 'true'
    );
  }
  function editorHasFocus(editor) {
    return (
      (!document.activeElement || document.activeElement === editor) &&
      (typeof document.hasFocus !== 'function' || document.hasFocus())
    );
  }
  async function awaitChat(delivery, requireEditor = false) {
    for (let i = 0; i < 40; i++) {
      if (blocked()) throw new Error('Verifikasi TikTok terdeteksi; selesaikan manual.');
      const root = chatRoot(delivery.username);
      if (root && senderMatches(delivery.senderUsername, delivery)) {
        if (!requireEditor) return root;
        const editors = chatEditors(root);
        if (editors.length === 1 && editorEnabled(editors[0])) return { root, editor: editors[0] };
      }
      await wait(500);
    }
    if (!senderMatches(delivery.senderUsername, delivery))
      throw new Error(
        typeof window !== 'undefined' && window !== window.top
          ? 'Chat Business Suite sudah ditemukan, tetapi akun pengirim belum dapat diverifikasi dari profil di chat atau halaman induk. Tidak mengirim.'
          : 'Akun pengirim belum dapat diverifikasi dari navigasi profil TikTok.',
      );
    if (requireEditor && chatRoot(delivery.username))
      throw new Error(
        'Chat penerima sudah terbuka, tetapi kolom pesan belum siap atau tidak dikenali dengan pasti. Tidak mengetik.',
      );
    throw new Error(
      `Chat aktif ${
        all('[data-e2e="chat-uniqueid"]')
          .map((element) => normalize(element.textContent))
          .join(', ') || 'belum dikenali'
      }, target @${delivery.username}. Penerima belum cocok/terverifikasi; tidak mengirim.`,
    );
  }
  globalThis.smgeDmPage = {
    identifySender() {
      if (blocked()) return { username: null, blocked: true };
      const identities = [
        ...new Set(
          all(senderSelector)
            .map((link) => username(link.href))
            .filter(Boolean),
        ),
      ];
      return { username: identities.length === 1 ? identities[0] : null, blocked: false };
    },
    locate(delivery) {
      return {
        path: location.pathname,
        chat: frameVisible() && !!chatRoot(delivery.username),
      };
    },
    async prepare(delivery) {
      try {
        await awaitChat(delivery, true);
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
      if (delivery.attemptId && globalThis.__smgeDmOpenedAttempt === delivery.attemptId)
        return {
          status: 'FAILED',
          detail:
            'Tombol Pesan sudah diklik untuk percobaan ini. Periksa chat; tidak membuka ulang otomatis.',
        };
      for (let i = 0; i < 30; i++) {
        if (blocked())
          return { status: 'FAILED', detail: 'Verifikasi TikTok terdeteksi; selesaikan manual.' };
        if (username(location.href) !== delivery.username)
          return { status: 'FAILED', detail: 'Profil penerima tidak cocok.' };
        const identities = [
          ...new Set(
            all(senderSelector)
              .map((link) => username(link.href))
              .filter(Boolean),
          ),
        ];
        if (
          identities.length &&
          (identities.length !== 1 || identities[0] !== delivery.senderUsername.toLowerCase())
        )
          return {
            status: 'FAILED',
            detail:
              'Akun login TikTok berbeda atau tidak dapat ditentukan dengan pasti. Tidak membuka chat.',
          };
        if (senderMatches(delivery.senderUsername, delivery)) {
          const candidates = all('[data-e2e="message-button"], button, a[role="button"]').filter(
            (element) =>
              element.matches('[data-e2e="message-button"]') ||
              /^(message|send message|pesan|kirim pesan)$/i.test(normalize(element.textContent)),
          );
          // A labelled wrapper and its child button are one control, not two CTAs.
          const buttons = candidates.filter(
            (element) => !candidates.some((other) => other !== element && element.contains(other)),
          );
          if (
            buttons.length === 1 &&
            !buttons[0].disabled &&
            buttons[0].getAttribute('aria-disabled') !== 'true'
          ) {
            globalThis.__smgeDmOpenedAttempt = delivery.attemptId;
            buttons[0].click();
            return { opened: true };
          }
        }
        await wait(500);
      }
      return {
        status: 'FAILED',
        detail: senderMatches(delivery.senderUsername, delivery)
          ? 'Tombol Pesan belum siap, tidak tersedia, atau ambigu setelah menunggu 15 detik. Tidak membuka chat.'
          : 'Profil belum siap atau akun pengirim belum dapat diverifikasi setelah menunggu 15 detik. Tidak membuka chat.',
      };
    },
    async focus(delivery) {
      try {
        if (!delivery.attemptId) throw new Error('ID percobaan pengiriman tidak tersedia.');
        if (globalThis.__smgeDmStage?.attemptId === delivery.attemptId)
          throw new Error('Percobaan ini sudah pernah menyiapkan editor; tidak mengetik ulang.');
        if (!frameVisible()) throw new Error('Iframe chat tidak terlihat. Tidak mengirim.');
        const { root, editor } = await awaitChat(delivery, true);
        if (normalize(textOf(editor)))
          throw new Error('Kolom pesan sudah berisi draft; periksa manual.');
        editor.focus();
        await wait(100);
        globalThis.__smgeDmStage = {
          attemptId: delivery.attemptId,
          username: delivery.username,
          senderUsername: delivery.senderUsername,
          root,
          editor,
          beforeCount: messageNodes(root, delivery.message).length,
        };
        if (editorHasFocus(editor)) return { focused: true };
        editor.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        const rect = editor.getBoundingClientRect();
        const hit = document.elementFromPoint?.(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (
          typeof document.elementFromPoint === 'function' &&
          hit !== editor &&
          !editor.contains(hit)
        )
          throw new Error('Kolom pesan tertutup elemen lain. Tidak mengetik.');
        return { needsFocus: true, action: { kind: 'click', ...clickPoint(editor) } };
      } catch (error) {
        return { status: 'FAILED', detail: error.message };
      }
    },
    async confirmFocus(delivery) {
      try {
        const state = globalThis.__smgeDmStage;
        for (let i = 0; i < 10; i++) {
          if (
            !state ||
            globalThis.__smgeDmStage !== state ||
            state.attemptId !== delivery.attemptId ||
            state.username !== delivery.username ||
            state.senderUsername !== delivery.senderUsername ||
            !frameVisible() ||
            blocked() ||
            !senderMatches(delivery.senderUsername, delivery) ||
            chatRoot(delivery.username) !== state.root ||
            state.editor.isConnected === false ||
            !editorEnabled(state.editor)
          )
            throw new Error(
              'Identitas chat atau editor berubah saat mengaktifkan kolom pesan. Tidak mengetik.',
            );
          if (normalize(textOf(state.editor)))
            throw new Error('Kolom pesan sudah berisi draft; periksa manual.');
          if (editorHasFocus(state.editor)) return { focused: true };
          await wait(100);
        }
        throw new Error('Kolom pesan belum mendapat fokus setelah klik browser. Tidak mengetik.');
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
          !frameVisible() ||
          blocked() ||
          !senderMatches(delivery.senderUsername, delivery) ||
          chatRoot(delivery.username) !== state.root
        )
          throw new Error('Identitas chat berubah sebelum kirim.');
        const editor = state.editor;
        if (editor.isConnected === false || !editorHasFocus(editor))
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
          const point = clickPoint(buttons[0]);
          return {
            ready: true,
            action: {
              kind: 'click',
              ...point,
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
            !frameVisible() ||
            blocked() ||
            chatRoot(delivery.username) !== state.root ||
            !senderMatches(delivery.senderUsername, delivery)
          )
            break;
          const current = messageNodes(state.root, delivery.message);
          const item = current.length > state.beforeCount ? current[current.length - 1] : null;
          if (item && !messagePending(item, state.root) && !normalize(textOf(state.editor))) {
            await wait(2000);
            if (
              frameVisible() &&
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
