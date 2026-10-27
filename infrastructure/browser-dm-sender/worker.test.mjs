import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const nativeSource = await readFile(new URL('./native-input.js', import.meta.url), 'utf8');
const delivery = {
  id: 'delivery-1',
  attemptId: 'attempt-1',
  username: 'recipient',
  senderUsername: 'sender',
  message: 'Approved message',
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise(setImmediate);
};

function fixture({
  initial = null,
  outcome = 'SENT',
  reportFailsOnce = false,
  stopDuringSend = false,
  prepareFails = false,
  businessSuite = false,
  duplicateFrames = false,
  frameReplaced = false,
} = {}) {
  let saved = initial;
  let listener;
  let alarm;
  let sends = 0;
  let reports = 0;
  let claims = 0;
  const calls = [];
  const scriptTargets = [];
  let tiktokUrl = 'https://www.tiktok.com/';
  const copy = (value) => (value ? JSON.parse(JSON.stringify(value)) : value);
  const command = (message) => new Promise((resolve) => listener(message, {}, resolve));
  const context = vm.createContext({
    importScripts: () => vm.runInContext(nativeSource, context),
    URL,
    crypto: { randomUUID: () => 'client-test' },
    setTimeout: (callback) => callback(),
    chrome: {
      debugger: {
        attach: async () => {},
        detach: async () => {},
        sendCommand: async (_target, method, parameters) => {
          if (method === 'Input.dispatchKeyEvent' && parameters.type === 'keyDown') {
            sends++;
            if (stopDuringSend) await command({ action: 'stop' });
          }
        },
      },
      storage: {
        local: {
          get: async () => ({ job: copy(saved) }),
          set: async ({ job }) => {
            saved = copy(job);
          },
        },
      },
      runtime: {
        onMessage: {
          addListener: (callback) => {
            listener = callback;
          },
        },
      },
      alarms: {
        create: async () => {},
        onAlarm: {
          addListener: (callback) => {
            alarm = callback;
          },
        },
      },
      tabs: {
        get: async (id) => ({
          id,
          url: id === 1 ? 'http://localhost:3000/outbound?account=account-test' : tiktokUrl,
          status: 'complete',
        }),
        create: async () => ({ id: 2 }),
        update: async (_id, { url }) => {
          tiktokUrl = url;
        },
      },
      scripting: {
        executeScript: async (options) => {
          scriptTargets.push({ target: options.target, method: options.args?.[0] });
          if (options.files) return [];
          const [path] = options.args;
          if (frameReplaced && path === 'focus' && options.target.documentIds)
            throw new Error('No document with the given ID');
          if (typeof path === 'object')
            return [
              {
                frameId: 0,
                documentId: 'shell',
                result: { path: '/business-suite/messages', chat: false },
              },
              {
                frameId: 8,
                documentId: 'video',
                result: { path: '/@someone/video/1', chat: true },
              },
              { frameId: 7, documentId: 'chat-doc', result: { path: '/messages', chat: true } },
              ...(duplicateFrames
                ? [
                    {
                      frameId: 9,
                      documentId: 'other-chat',
                      result: { path: '/messages', chat: true },
                    },
                  ]
                : []),
            ];
          calls.push(path);
          if (path === 'claim') {
            claims++;
            return [{ result: { ok: true, data: claims === 1 ? delivery : null } }];
          }
          if (path.endsWith('/authorize'))
            return [{ result: { ok: true, data: { allowed: true } } }];
          if (path.endsWith('/result')) {
            reports++;
            if (reportFailsOnce && reports === 1) throw new Error('Response lost');
            return [{ result: { ok: true, data: { saved: true } } }];
          }
          if (path === 'open') {
            if (businessSuite) tiktokUrl = 'https://www.tiktok.com/business-suite/messages';
            return [{ result: { opened: true } }];
          }
          if (path === 'prepare')
            return [
              {
                result: prepareFails
                  ? { status: 'FAILED', detail: 'Wrong active recipient' }
                  : { ready: true },
              },
            ];
          if (path === 'focus') return [{ result: { focused: true } }];
          if (path === 'inspect') return [{ result: { ready: true, action: { kind: 'enter' } } }];
          if (path === 'observe') {
            return [{ result: { status: outcome, detail: 'Fixture outcome' } }];
          }
          throw new Error('Unexpected script call');
        },
      },
    },
  });
  vm.runInContext(source, context);
  return {
    command,
    next: async () => {
      alarm({ name: 'smge-dm-next' });
      await flush();
    },
    state: () => saved,
    counts: () => ({ sends, reports, claims }),
    calls,
    scriptTargets,
    start: async () => {
      await command({
        action: 'start',
        origin: 'http://localhost:3000',
        dashboardTabId: 1,
        accountId: 'account-test',
      });
      await flush();
    },
  };
}

test('one click attempt per claim, then moves to the next alarm instead of an immediate send loop', async () => {
  const f = fixture();
  await f.start();
  assert.deepEqual(f.counts(), { sends: 1, reports: 1, claims: 1 });
  assert.equal(f.state().current, null);
  assert.equal(f.state().active, true);
  await f.next();
  assert.equal(f.state().active, false);
  assert.equal(f.counts().sends, 1);
});

test('Business Suite pins all chat operations to the matching iframe document, ignoring the video frame', async () => {
  const f = fixture({ businessSuite: true });
  await f.start();
  assert.equal(f.counts().sends, 1);
  for (const method of ['prepare', 'focus', 'inspect', 'observe']) {
    const operations = f.scriptTargets.filter((item) => item.method === method);
    assert.ok(operations.length);
    for (const item of operations)
      assert.deepEqual(Array.from(item.target.documentIds), ['chat-doc']);
  }
});

test('ambiguous Business Suite frames fail before typing, authorization, or sending', async () => {
  const f = fixture({ businessSuite: true, duplicateFrames: true });
  await f.start();
  assert.equal(f.counts().sends, 0);
  assert.equal(f.state().active, false);
  assert.ok(!f.calls.some((path) => path === 'focus' || path.endsWith('/authorize')));
});

test('a replaced Business Suite iframe document never falls back to a different frame', async () => {
  const f = fixture({ businessSuite: true, frameReplaced: true });
  await f.start();
  assert.equal(f.counts().sends, 0);
  assert.equal(f.state().active, false);
  assert.ok(!f.calls.some((path) => path.endsWith('/authorize')));
  const focus = f.scriptTargets.filter((item) => item.method === 'focus');
  assert.equal(focus.length, 1);
  assert.deepEqual(Array.from(focus[0].target.documentIds), ['chat-doc']);
});
test('uncertain result stops automatic progression', async () => {
  const f = fixture({ outcome: 'UNVERIFIED' });
  await f.start();
  await f.next();
  assert.equal(f.state().active, false);
  assert.equal(f.counts().sends, 1);
  assert.equal(f.counts().claims, 1);
});
test('a chat that is not ready is reported as failed before authorization or sending', async () => {
  const f = fixture({ prepareFails: true });
  await f.start();
  assert.equal(f.state().active, false);
  assert.equal(f.counts().sends, 0);
  assert.equal(
    f.calls.some((path) => path.endsWith('/authorize')),
    false,
  );
  assert.equal(f.counts().reports, 1);
});
test('a lost report response retries reporting without sending twice', async () => {
  const f = fixture({ reportFailsOnce: true });
  await f.start();
  assert.ok(f.state().pendingReport);
  assert.equal(f.state().active, false);
  await f.next();
  assert.deepEqual(f.counts(), { sends: 1, reports: 2, claims: 1 });
  assert.equal(f.state().current, null);
});
test('worker restart with an unfinished attempt reports uncertain and never clicks Send', async () => {
  const f = fixture({
    initial: {
      origin: 'http://localhost:3000',
      dashboardTabId: 1,
      accountId: 'account-test',
      clientId: 'client-test',
      active: true,
      current: { id: delivery.id, attemptId: delivery.attemptId },
    },
  });
  // Registering the alarm persists independently of the worker process.
  await f.next();
  assert.deepEqual(f.counts(), { sends: 0, reports: 1, claims: 0 });
  assert.equal(f.state().active, false);
  assert.equal(f.state().current, null);
});
test('stop received during a send is preserved when the result is saved', async () => {
  const f = fixture({ stopDuringSend: true });
  await f.start();
  await f.next();
  assert.equal(f.state().active, false);
  assert.equal(f.counts().sends, 1);
  assert.equal(f.counts().claims, 1);
});
