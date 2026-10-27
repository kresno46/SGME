import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { parseHTML } from 'linkedom';

const source = await readFile(new URL('./page.js', import.meta.url), 'utf8');
const delivery = {
  attemptId: 'attempt-test',
  senderUsername: 'sender_test',
  username: 'recipient_test',
  message: 'Pesan yang sudah disetujui.',
};

// DOM structure and marker names reproduced from the supplied diagnostic.
// Profile identities are replaced with test names; no live messages are sent.
function fixture({
  recipient = 'recipient_test',
  sender = 'sender_test',
  draft = '',
  result = 'sent',
  labelledButton = false,
  disabled = false,
  delayed = false,
  businessFrame = false,
  parentSender = 'sender_test',
  hiddenFrame = false,
} = {}) {
  const { document, window } = parseHTML(`<!doctype html><html><body>
    <nav><a data-e2e="nav-profile" href="https://www.tiktok.com/@${sender}">Profil</a></nav>
    <aside><a href="https://www.tiktok.com/@recipient_test">Nama tampilan sama</a></aside>
    <div data-e2e="dm-new-chatbox" class="css-example--DivChatBox edjqxpv0">
      <div class="css-example--DivChatHeader edjqxpv1">
        <div role="link" class="css-example--DivChatHeaderContentWrapper edjqxpv2">
          <a id="recipient-profile" href="https://www.tiktok.com/@${recipient}"><span data-e2e="top-chat-avatar"></span><p data-e2e="dm-new-chat-nickname">Nama tampilan sama</p><p data-e2e="chat-uniqueid">@${recipient}</p></a>
        </div>
      </div>
      <div data-e2e="dm-new-message-list" role="log"></div>
      <div data-e2e="dm-new-chat-bottom"><div data-e2e="message-input-area"><div data-e2e="dm-new-input-editor"><div class="DraftEditor-root"><div class="DraftEditor-editorContainer"><div contenteditable="true" role="textbox" class="notranslate public-DraftEditor-content"></div></div></div></div></div></div>
    </div>
  </body></html>`);
  window.Element.prototype.getClientRects = function () {
    return this.hasAttribute('hidden') ? [] : [{}];
  };
  window.Element.prototype.getBoundingClientRect = () => ({ x: 20, y: 20, width: 100, height: 30 });
  const editor = document.querySelector('[contenteditable]');
  editor.textContent = draft;
  editor.focus = () => {};
  const list = document.querySelector('[role="log"]');
  let attempts = 0;
  let timers = 0;
  const message = () => {
    const wrapper = document.createElement('div');
    const bubble = document.createElement('span');
    bubble.textContent = delivery.message;
    wrapper.append(bubble);
    list.append(wrapper);
    return wrapper;
  };
  if (result === 'rerender') message();
  const onSend = () => {
    attempts++;
    if (result === 'unknown') return;
    editor.textContent = '';
    if (result === 'rerender') list.textContent = '';
    const wrapper = message();
    if (result === 'pending') {
      const icon = document.createElement('i');
      icon.setAttribute('data-e2e', 'sending');
      wrapper.append(icon);
    }
  };
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onSend();
  });
  if (labelledButton) {
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Send');
    button.disabled = disabled;
    button.addEventListener('click', onSend);
    document.querySelector('[data-e2e="dm-new-chat-bottom"]').append(button);
  }
  document.execCommand = () => {
    throw new Error('Do not mutate controlled editors with execCommand');
  };
  class KeyboardEvent extends window.Event {
    constructor(type, options) {
      super(type, options);
      Object.assign(this, { key: options.key, code: options.code, keyCode: options.keyCode });
    }
  }
  let frameWindow;
  if (businessFrame) {
    document.querySelector('nav').remove();
    const outer = parseHTML(
      `<html><body><nav><a data-e2e="nav-profile" href="https://www.tiktok.com/@${parentSender}">Profil</a></nav></body></html>`,
    );
    outer.window.Element.prototype.getClientRects = () => [{}];
    const top = { document: outer.document, location: { origin: 'https://www.tiktok.com' } };
    top.top = top;
    frameWindow = {
      parent: top,
      top,
      frameElement: {
        getClientRects: () => (hiddenFrame ? [] : [{}]),
        getBoundingClientRect: () => ({ x: 218, y: 120, width: 1100, height: 563 }),
      },
    };
  }
  const context = vm.createContext({
    ...(frameWindow ? { window: frameWindow } : {}),
    URL,
    document,
    Event: window.Event,
    InputEvent: window.Event,
    KeyboardEvent,
    location: { href: 'https://www.tiktok.com/messages?lang=en' },
    setTimeout: (callback) => {
      timers++;
      if (delayed && timers === 3) {
        document.querySelector('[data-e2e="chat-uniqueid"]').textContent = '@recipient_test';
        document.getElementById('recipient-profile').href =
          'https://www.tiktok.com/@recipient_test';
      }
      callback();
    },
  });
  vm.runInContext(source, context);
  return {
    send: async () => {
      const focus = await context.smgeDmPage.focus(delivery);
      if (!focus.focused) return focus;
      // Native input is exercised through CDP in native-browser.test.mjs.
      editor.textContent = delivery.message;
      const ready = await context.smgeDmPage.inspect(delivery);
      if (!ready.ready) return ready;
      if (ready.action.kind === 'click')
        document.querySelector('button[aria-label="Send"]').click();
      else onSend();
      return context.smgeDmPage.observe(delivery);
    },
    prepare: () => context.smgeDmPage.prepare(delivery),
    attempts: () => attempts,
    editor,
    document,
  };
}

test('recognizes diagnostic dm-new-chatbox/chat-uniqueid and sends once through DraftJS Enter', async () => {
  const f = fixture();
  assert.equal((await f.send()).status, 'SENT');
  assert.equal(f.attempts(), 1);
});

test('Business Suite iframe uses a visible parent profile to verify sender, not the recipient handle', async () => {
  const f = fixture({ businessFrame: true });
  assert.equal((await f.send()).status, 'SENT');
  assert.equal(f.attempts(), 1);
  for (const options of [
    { parentSender: 'other_sender' },
    { parentSender: '' },
    { hiddenFrame: true },
  ]) {
    const rejected = fixture({ businessFrame: true, ...options });
    assert.equal((await rejected.send()).status, 'FAILED');
    assert.equal(rejected.attempts(), 0);
    assert.equal(rejected.editor.textContent, '');
  }
});
test('readiness waits for the header without typing or attempting a send', async () => {
  const f = fixture({ recipient: 'previous_chat', delayed: true });
  assert.equal((await f.prepare()).ready, true);
  assert.equal(f.attempts(), 0);
  assert.equal(f.editor.textContent, '');
});
test('labelled send button and new message list are supported without an extra Enter', async () => {
  const f = fixture({ labelledButton: true });
  assert.equal((await f.send()).status, 'SENT');
  assert.equal(f.attempts(), 1);
});
test('waits for a stale chat header to switch to the intended recipient', async () => {
  const f = fixture({ recipient: 'previous_chat', delayed: true });
  assert.equal((await f.send()).status, 'SENT');
  assert.equal(f.attempts(), 1);
});
test('never uses a matching sidebar link or display name to send to the wrong selected chat', async () => {
  const f = fixture({ recipient: 'different_chat' });
  const result = await f.send();
  assert.equal(result.status, 'FAILED');
  assert.match(result.detail, /different_chat/);
  assert.equal(f.attempts(), 0);
  assert.equal(f.editor.textContent, '');
});
test('rejects wrong sender, preserves human drafts, and does not bypass a disabled Send button', async () => {
  for (const args of [
    { sender: 'other_sender' },
    { draft: 'Human draft' },
    { labelledButton: true, disabled: true },
  ]) {
    const f = fixture(args);
    assert.equal((await f.send()).status, 'FAILED');
    assert.equal(f.attempts(), 0);
  }
});
test('a pending message or missing evidence remains uncertain after one attempt', async () => {
  for (const result of ['unknown', 'pending']) {
    const f = fixture({ result });
    assert.equal((await f.send()).status, 'UNVERIFIED');
    assert.equal(f.attempts(), 1);
  }
});
test('rerendering a historical identical message never confirms a new send', async () => {
  const f = fixture({ result: 'rerender' });
  assert.equal((await f.send()).status, 'UNVERIFIED');
  assert.equal(f.attempts(), 1);
});
