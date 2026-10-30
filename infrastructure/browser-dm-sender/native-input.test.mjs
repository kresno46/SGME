import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source = await readFile(new URL('./native-input.js', import.meta.url), 'utf8');

function fixture({
  origin = 'https://www.tiktok.com/messages',
  attachError = false,
  mismatch = false,
  authorized = true,
  active = true,
  interrupted = false,
  action = { kind: 'enter' },
  needsFocus = false,
  focusConfirmed = true,
} = {}) {
  const calls = [];
  const context = vm.createContext({
    URL,
    chrome: {
      tabs: { get: async () => ({ url: origin }) },
      debugger: {
        attach: async (target) => {
          calls.push({ method: 'attach', target });
          if (attachError) throw new Error('Already attached');
        },
        detach: async (target) => {
          calls.push({ method: 'detach', target });
        },
        sendCommand: async (target, method, parameters) => {
          calls.push({ method, parameters, target });
          if (interrupted && method === 'Input.dispatchKeyEvent')
            throw new Error('Response interrupted after key dispatch');
        },
      },
    },
  });
  vm.runInContext(source, context);
  return {
    calls,
    send: () =>
      context.smgeNativeInput({
        tabId: 17,
        delivery: { message: 'Approved template' },
        page: async (method) => {
          calls.push({ method });
          if (method === 'focus')
            return needsFocus
              ? { needsFocus: true, action: { kind: 'click', x: 200, y: 300 } }
              : { focused: true };
          if (method === 'confirmFocus')
            return focusConfirmed
              ? { focused: true }
              : { status: 'FAILED', detail: 'Editor focus not acquired' };
          if (method === 'inspect')
            return mismatch
              ? { status: 'FAILED', detail: 'Wrong editor text' }
              : { ready: true, action };
          return { status: 'SENT', detail: 'Observed fixture message' };
        },
        authorize: async () => {
          calls.push({ method: 'authorize' });
          if (!authorized) throw new Error('DNC changed');
        },
        isActive: async () => active,
      }),
  };
}

test('native insert precedes validation/authorization and Enter is dispatched exactly once', async () => {
  const f = fixture();
  assert.equal((await f.send()).status, 'SENT');
  assert.deepEqual(
    f.calls.map((call) => call.method),
    [
      'attach',
      'focus',
      'Input.insertText',
      'inspect',
      'authorize',
      'inspect',
      'Input.dispatchKeyEvent',
      'Input.dispatchKeyEvent',
      'observe',
      'detach',
    ],
  );
  const keys = f.calls.filter((call) => call.method === 'Input.dispatchKeyEvent');
  assert.equal(keys[0].parameters.type, 'keyDown');
  assert.equal(keys[1].parameters.type, 'keyUp');
  assert.ok(f.calls.filter((call) => call.target).every((call) => call.target.tabId === 17));
});

test('native editor click is confirmed before one text insertion and one send action', async () => {
  const f = fixture({ needsFocus: true });
  assert.equal((await f.send()).status, 'SENT');
  const names = f.calls.map((call) => call.method);
  assert.ok(names.indexOf('Page.bringToFront') < names.indexOf('confirmFocus'));
  assert.ok(names.indexOf('confirmFocus') < names.indexOf('Input.insertText'));
  assert.equal(names.filter((name) => name === 'Input.insertText').length, 1);
  assert.equal(
    f.calls.filter(
      (call) => call.method === 'Input.dispatchKeyEvent' && call.parameters.type === 'keyDown',
    ).length,
    1,
  );
  const clicks = f.calls.filter((call) => call.method === 'Input.dispatchMouseEvent');
  assert.equal(clicks.length, 2);
  assert.equal(clicks[0].parameters.x, 200);
  assert.equal(clicks[0].parameters.y, 300);
});

test('failed focus confirmation never types, authorizes or clicks send', async () => {
  const f = fixture({ needsFocus: true, focusConfirmed: false });
  assert.equal((await f.send()).status, 'FAILED');
  assert.ok(
    !f.calls.some(
      (call) =>
        call.method === 'Input.insertText' ||
        call.method === 'authorize' ||
        call.method === 'Input.dispatchKeyEvent',
    ),
  );
});
test('no send is attempted when text mismatches, authorization fails, or operator stops', async () => {
  for (const options of [{ mismatch: true }, { authorized: false }, { active: false }]) {
    const f = fixture(options);
    assert.equal((await f.send()).status, 'FAILED');
    assert.equal(
      f.calls.some((call) => call.method.includes('dispatch')),
      false,
    );
    assert.equal(f.calls.at(-1).method, 'detach');
  }
});
test('never attaches outside TikTok and reports debugger attachment conflicts clearly', async () => {
  const wrong = fixture({ origin: 'https://example.com/messages' });
  assert.equal((await wrong.send()).status, 'FAILED');
  assert.equal(wrong.calls.length, 0);
  const conflict = fixture({ attachError: true });
  const result = await conflict.send();
  assert.equal(result.status, 'FAILED');
  assert.match(result.detail, /DevTools/);
  assert.equal(
    conflict.calls.some((call) => call.method === 'Input.insertText'),
    false,
  );
});
test('a lost key dispatch response is uncertain and never triggers another send mechanism', async () => {
  const f = fixture({ interrupted: true });
  assert.equal((await f.send()).status, 'UNVERIFIED');
  assert.equal(f.calls.filter((call) => call.method.includes('dispatch')).length, 1);
  assert.equal(f.calls.at(-1).method, 'detach');
});
test('a recognized send button uses a single native click instead of Enter', async () => {
  const f = fixture({ action: { kind: 'click', x: 50, y: 90 } });
  assert.equal((await f.send()).status, 'SENT');
  const click = f.calls.filter((call) => call.method === 'Input.dispatchMouseEvent');
  assert.deepEqual(
    click.map((call) => call.parameters.type),
    ['mousePressed', 'mouseReleased'],
  );
  assert.equal(
    f.calls.some((call) => call.method === 'Input.dispatchKeyEvent'),
    false,
  );
});
