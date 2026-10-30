import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { parseHTML } from 'linkedom';

const source = await readFile(new URL('./page.js', import.meta.url), 'utf8');
const delivery = {
  attemptId: 'personal-readiness',
  username: 'recipient_test',
  senderUsername: 'sender_test',
  message: 'Test message',
};
function fixture(onTick = () => {}, sender = 'sender_test') {
  const { document, window } = parseHTML('<html><body></body></html>');
  window.Element.prototype.getClientRects = function () {
    return this.hasAttribute('hidden') ? [] : [{}];
  };
  let ticks = 0;
  let clicks = 0;
  const add = (html) => {
    document.body.insertAdjacentHTML('beforeend', html);
  };
  const profile = () =>
    add(`<a data-e2e="nav-profile" href="https://www.tiktok.com/@${sender}">Profile</a>`);
  const button = (wrapped = false) => {
    add(
      wrapped
        ? '<div data-e2e="message-button"><button>Message</button></div>'
        : '<button data-e2e="message-button">Message</button>',
    );
    document.querySelector('button').addEventListener('click', () => {
      clicks++;
    });
  };
  const chat = () =>
    add(
      '<div data-e2e="dm-new-chatbox"><header data-e2e="chat-header"><a href="https://www.tiktok.com/@recipient_test">Recipient</a></header></div>',
    );
  const editor = (extra = '') =>
    document
      .querySelector('[data-e2e="dm-new-chatbox"]')
      .insertAdjacentHTML('beforeend', `<textarea ${extra}></textarea>`);
  const tools = { document, add, profile, button, chat, editor };
  const context = vm.createContext({
    URL,
    document,
    location: { href: 'https://www.tiktok.com/@recipient_test' },
    setTimeout(callback) {
      ticks++;
      onTick(ticks, tools);
      callback();
    },
  });
  vm.runInContext(source, context);
  return { ...tools, api: context.smgeDmPage, ticks: () => ticks, clicks: () => clicks };
}

test('waits beyond the old 1.5-second delay for profile identity and CTA, then clicks only once', async () => {
  const f = fixture((tick, ui) => {
    if (tick === 5) ui.profile();
    if (tick === 8) ui.button();
  });
  assert.equal((await f.api.open(delivery)).opened, true);
  assert.ok(f.ticks() >= 8);
  assert.equal(f.clicks(), 1);
  assert.equal((await f.api.open(delivery)).status, 'FAILED');
  assert.equal(f.clicks(), 1);
});

test('a temporarily disabled CTA becomes ready without repeated clicks', async () => {
  const f = fixture((tick, ui) => {
    if (tick === 4) ui.document.querySelector('button').removeAttribute('aria-disabled');
  });
  f.profile();
  f.button();
  f.document.querySelector('button').setAttribute('aria-disabled', 'true');
  assert.equal((await f.api.open(delivery)).opened, true);
  assert.equal(f.clicks(), 1);
});

test('a wrapper plus child button is one CTA, whereas separate ambiguous CTAs are not clicked', async () => {
  const f = fixture();
  f.profile();
  f.button(true);
  assert.equal((await f.api.open(delivery)).opened, true);
  assert.equal(f.clicks(), 1);
  const ambiguous = fixture();
  ambiguous.profile();
  ambiguous.button();
  ambiguous.button();
  assert.equal((await ambiguous.api.open(delivery)).status, 'FAILED');
  assert.equal(ambiguous.clicks(), 0);
});

test('waits for the matching chat AND an enabled editor; a header alone is insufficient', async () => {
  const f = fixture((tick, ui) => {
    if (tick === 3) ui.chat();
    if (tick === 9) ui.editor('readonly');
    if (tick === 12) ui.document.querySelector('textarea').removeAttribute('readonly');
  });
  f.profile();
  assert.equal((await f.api.prepare(delivery)).ready, true);
  assert.ok(f.ticks() >= 12);
  assert.equal(f.clicks(), 0);
  assert.equal(f.document.querySelector('textarea').value, '');
});

test('missing editor, wrong sender, CAPTCHA and a human draft never produce a send or overwritten draft', async () => {
  const missing = fixture();
  missing.profile();
  missing.chat();
  assert.equal((await missing.api.prepare(delivery)).status, 'FAILED');
  const wrong = fixture(() => {}, 'other_sender');
  wrong.profile();
  wrong.button();
  assert.equal((await wrong.api.open(delivery)).status, 'FAILED');
  assert.equal(wrong.clicks(), 0);
  const captcha = fixture();
  captcha.profile();
  captcha.button();
  captcha.add('<div data-e2e="captcha"></div>');
  assert.equal((await captcha.api.open(delivery)).status, 'FAILED');
  assert.equal(captcha.clicks(), 0);
  const draft = fixture();
  draft.profile();
  draft.chat();
  draft.editor();
  draft.document.querySelector('textarea').textContent = 'Human draft';
  assert.equal((await draft.api.focus(delivery)).status, 'FAILED');
  assert.equal(draft.document.querySelector('textarea').value, 'Human draft');
});
