import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source = await readFile(new URL('./page.js', import.meta.url), 'utf8');
const delivery = {
  attemptId: 'attempt-legacy',
  senderUsername: 'sender_test',
  username: 'recipient_test',
  message: 'Hello approved message',
};

function fixture({
  sender = 'sender_test',
  target = 'recipient_test',
  confirm = true,
  pending = false,
  draft = '',
  captcha = false,
} = {}) {
  let clicks = 0;
  let messages = [];
  const visible = { getClientRects: () => [1] };
  const editor = { ...visible, tagName: 'DIV', textContent: draft, focus() {}, dispatchEvent() {} };
  const message = {
    ...visible,
    textContent: delivery.message,
    isConnected: true,
    querySelector: () => (pending ? {} : null),
  };
  const button = {
    ...visible,
    disabled: false,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ x: 20, y: 20, width: 30, height: 30 }),
    click() {
      clicks++;
      if (confirm) {
        editor.textContent = '';
        messages.push(message);
      }
    },
  };
  const root = {
    querySelectorAll(selector) {
      if (selector.includes('contenteditable')) return [editor];
      if (selector.includes('chat-item')) return messages;
      if (selector.includes('message-send')) return [button];
      return [];
    },
  };
  const header = {
    ...visible,
    querySelectorAll: () => [{ ...visible, href: `https://www.tiktok.com/@${target}` }],
    closest: () => root,
  };
  const context = vm.createContext({
    URL,
    Event: class {},
    InputEvent: class {},
    location: { href: 'https://www.tiktok.com/@recipient_test' },
    setTimeout: (callback) => callback(),
    document: {
      querySelector: () => (captcha ? {} : null),
      querySelectorAll(selector) {
        if (selector.includes('nav-profile'))
          return [{ ...visible, href: `https://www.tiktok.com/@${sender}` }];
        if (selector.includes('chat-header')) return [header];
        return [];
      },
      execCommand(_action, _ui, value) {
        editor.textContent = value;
        return true;
      },
    },
  });
  vm.runInContext(source, context);
  return {
    send: async () => {
      const focused = await context.smgeDmPage.focus(delivery);
      if (!focused.focused) return focused;
      editor.textContent = delivery.message;
      const ready = await context.smgeDmPage.inspect(delivery);
      if (!ready.ready) return ready;
      button.click();
      return context.smgeDmPage.observe(delivery);
    },
    clicks: () => clicks,
    messages: (value) => {
      messages = value;
    },
  };
}

test('clicks send once and requires a new stable message with an empty editor', async () => {
  const f = fixture();
  assert.equal((await f.send()).status, 'SENT');
  assert.equal(f.clicks(), 1);
});
test('does not send from another or unknown account', async () => {
  const f = fixture({ sender: 'wrong_user' });
  assert.equal((await f.send()).status, 'FAILED');
  assert.equal(f.clicks(), 0);
});
test('does not send to an unverified recipient or overwrite an existing draft', async () => {
  for (const args of [{ target: 'wrong_user' }, { draft: 'Human draft' }, { captcha: true }]) {
    const f = fixture(args);
    assert.equal((await f.send()).status, 'FAILED');
    assert.equal(f.clicks(), 0);
  }
});
test('a click without delivery evidence is uncertain, never retried', async () => {
  const f = fixture({ confirm: false });
  assert.equal((await f.send()).status, 'UNVERIFIED');
  assert.equal(f.clicks(), 1);
});
test('pending/failed outgoing messages are not treated as sent', async () => {
  const f = fixture({ pending: true });
  assert.equal((await f.send()).status, 'UNVERIFIED');
  assert.equal(f.clicks(), 1);
});
test('an existing identical message is not enough to confirm a new delivery', async () => {
  const f = fixture({ confirm: false });
  f.messages([{ getClientRects: () => [1], textContent: delivery.message }]);
  assert.equal((await f.send()).status, 'UNVERIFIED');
  assert.equal(f.clicks(), 1);
});
