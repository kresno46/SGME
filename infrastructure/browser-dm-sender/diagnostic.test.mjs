import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source = await readFile(new URL('./page.js', import.meta.url), 'utf8');

test('diagnostics export structure and profile handles without message bodies, editor values, cookies, or URL tokens', () => {
  function element(tag, attributes, textContent = '') {
    return {
      tagName: tag,
      textContent,
      parentElement: null,
      getClientRects: () => [1],
      getBoundingClientRect: () => ({ x: 340, y: 40, width: 400, height: 40 }),
      getAttribute: (key) => attributes[key] ?? null,
      matches: () => tag === 'TEXTAREA',
      click() {
        throw new Error('Diagnostic must never click');
      },
      get value() {
        throw new Error('Diagnostic must never read editor values');
      },
      get outerHTML() {
        throw new Error('Diagnostic must never export HTML');
      },
    };
  }
  const root = element('DIV', { class: 'DivChatBox' });
  const editor = element(
    'TEXTAREA',
    { placeholder: 'Send a message...', 'data-e2e': 'message-input' },
    'private draft body',
  );
  editor.parentElement = root;
  const message = element('DIV', { 'data-e2e': 'chat-item' }, 'private conversation body');
  const profile = element('A', {});
  profile.href = 'https://www.tiktok.com/@recipient_test?token=private-query-token';
  const handle = element('SPAN', {}, '@recipient_test');
  handle.parentElement = root;
  const document = {
    querySelectorAll: (selector) =>
      selector === 'a, span, p, div' ? [handle, message] : [editor, message, profile],
    get cookie() {
      throw new Error('Diagnostic must never read cookies');
    },
  };
  const context = vm.createContext({
    URL,
    document,
    location: {
      pathname: '/messages',
      href: 'https://www.tiktok.com/messages?secret=private-url-secret',
    },
  });
  vm.runInContext(source, context);
  const result = context.smgeDmPage.diagnose();
  const json = JSON.stringify(result);
  assert.equal(result.format, 'smge-dm-diagnostic-v1');
  assert.equal(result.path, '/messages');
  assert.equal(result.elements[0].placeholder, 'Send a message...');
  assert.equal(result.elements[0].parents[0].classes, 'DivChatBox');
  assert.equal(result.elements[2].profileUsername, 'recipient_test');
  assert.equal(result.handles[0].handle, '@recipient_test');
  for (const privateValue of [
    'private draft body',
    'private conversation body',
    'private-query-token',
    'private-url-secret',
  ])
    assert.ok(!json.includes(privateValue));
});
