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
  probeSender = 'sender',
  probeBlocked = false,
  probeUrlStates = [],
  probeNeverReady = false,
  queuedDeliveries = [delivery],
  prepareFailsAt = [],
  stopDuringPrepare = false,
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
  let probeUrl = '';
  let probePoll = 0;
  const closedTabs = [];
  const reported = [];
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
        get: async (id) =>
          id === 3 && (probeNeverReady || probePoll < probeUrlStates.length)
            ? {
                id,
                ...(probeNeverReady
                  ? { status: 'loading', pendingUrl: probeUrl }
                  : probeUrlStates[probePoll++]),
              }
            : {
                id,
                url:
                  id === 1
                    ? 'http://localhost:3000/outbound?account=account-test'
                    : id === 3
                      ? probeUrl
                      : tiktokUrl,
                status: 'complete',
              },
        create: async ({ url, active }) => {
          if (active === false) {
            probeUrl = url;
            probePoll = 0;
            return { id: 3 };
          }
          return { id: 2 };
        },
        remove: async (id) => {
          closedTabs.push(id);
        },
        reload: async () => {
          probePoll = 0;
        },
        update: async (id, { url }) => {
          if (id === 3) probeUrl = url;
          else tiktokUrl = url;
        },
      },
      scripting: {
        executeScript: async (options) => {
          scriptTargets.push({ target: options.target, method: options.args?.[0] });
          if (options.files) return [];
          const [path] = options.args;
          if (options.target.tabId === 3)
            return [{ result: { username: probeSender, blocked: probeBlocked } }];
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
            return [{ result: { ok: true, data: queuedDeliveries[claims - 1] ?? null } }];
          }
          if (path.endsWith('/authorize'))
            return [{ result: { ok: true, data: { allowed: true } } }];
          if (path.endsWith('/result')) {
            reports++;
            if (reportFailsOnce && reports === 1) throw new Error('Response lost');
            reported.push({ path, status: options.args[1].status });
            return [{ result: { ok: true, data: { saved: true } } }];
          }
          if (path === 'open') {
            if (businessSuite) tiktokUrl = 'https://www.tiktok.com/business-suite/messages';
            return [{ result: { opened: true } }];
          }
          if (path === 'prepare') {
            if (stopDuringPrepare) await command({ action: 'stop' });
            return [
              {
                result:
                  prepareFails || prepareFailsAt.includes(claims)
                    ? { status: 'FAILED', detail: 'Wrong active recipient' }
                    : { ready: true },
              },
            ];
          }
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
    closedTabs,
    reported,
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
  assert.equal(f.state().active, true);
  assert.ok(!f.calls.some((path) => path === 'focus' || path.endsWith('/authorize')));
});

test('a replaced Business Suite iframe document never falls back to a different frame', async () => {
  const f = fixture({ businessSuite: true, frameReplaced: true });
  await f.start();
  assert.equal(f.counts().sends, 0);
  assert.equal(f.state().active, true);
  assert.ok(!f.calls.some((path) => path.endsWith('/authorize')));
  const focus = f.scriptTargets.filter((item) => item.method === 'focus');
  assert.equal(focus.length, 1);
  assert.deepEqual(Array.from(focus[0].target.documentIds), ['chat-doc']);
});

test('Business Suite rejects a different logged-in account and closes its verification tab', async () => {
  for (const options of [
    { probeSender: 'wrong_sender' },
    { probeSender: null },
    { probeBlocked: true },
  ]) {
    const f = fixture({ businessSuite: true, ...options });
    await f.start();
    assert.equal(f.counts().sends, 0);
    assert.equal(f.state().active, true);
    assert.ok(!f.calls.some((path) => path.endsWith('/authorize')));
    assert.deepEqual(f.closedTabs, [3]);
  }
});

test('a new/reloading sender tab can have no committed URL until navigation is complete', async () => {
  const f = fixture({
    businessSuite: true,
    probeUrlStates: [
      { status: 'loading', pendingUrl: 'https://www.tiktok.com/@sender' },
      { status: 'loading', url: '', pendingUrl: 'https://www.tiktok.com/@sender' },
      { status: 'complete', url: 'about:blank', pendingUrl: 'https://www.tiktok.com/@sender' },
    ],
  });
  await f.start();
  assert.equal(f.counts().sends, 1, f.state().detail);
  assert.deepEqual(f.closedTabs, [3]);
});

test('an unavailable or foreign sender-tab URL never permits typing or sending', async () => {
  for (const options of [
    { probeNeverReady: true },
    { probeUrlStates: [{ status: 'complete', url: 'not-a-url' }] },
    { probeUrlStates: [{ status: 'complete', url: 'https://example.invalid/@sender' }] },
  ]) {
    const f = fixture({ businessSuite: true, ...options });
    await f.start();
    assert.equal(f.counts().sends, 0);
    assert.equal(f.state().active, true);
    assert.ok(!f.calls.includes('focus'));
    assert.doesNotMatch(f.state().detail, /Failed to construct|Invalid URL/);
    assert.deepEqual(f.closedTabs, [3]);
  }
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
  assert.equal(f.state().active, true);
  assert.equal(f.counts().sends, 0);
  assert.equal(
    f.calls.some((path) => path.endsWith('/authorize')),
    false,
  );
  assert.equal(f.counts().reports, 1);
});

test('five recipients: a failed second recipient is recorded once and does not block recipients 3–5', async () => {
  const batch = Array.from({ length: 5 }, (_, i) => ({
    ...delivery,
    id: `delivery-${i + 1}`,
    attemptId: `attempt-${i + 1}`,
    username: `recipient_${i + 1}`,
  }));
  const f = fixture({ queuedDeliveries: batch, prepareFailsAt: [2] });
  await f.start();
  await f.next();
  assert.equal(f.state().active, true);
  assert.match(f.state().detail, /dilewati/);
  assert.equal(f.counts().sends, 1);
  for (let i = 0; i < 3; i++) await f.next();
  assert.deepEqual(f.counts(), { sends: 4, reports: 5, claims: 5 });
  assert.deepEqual(
    f.reported.map((item) => item.status),
    ['SENT', 'FAILED', 'SENT', 'SENT', 'SENT'],
  );
  assert.deepEqual(
    f.reported.map((item) => item.path),
    batch.map((item) => `${item.id}/result`),
  );
  await f.next();
  assert.equal(f.state().active, false);
});

test('operator stop during a failed attempt is preserved and prevents claiming another recipient', async () => {
  const f = fixture({
    prepareFails: true,
    stopDuringPrepare: true,
    queuedDeliveries: [delivery, { ...delivery, id: 'delivery-2' }],
  });
  await f.start();
  await f.next();
  assert.equal(f.state().active, false);
  assert.deepEqual(f.counts(), { sends: 0, reports: 1, claims: 1 });
});

test('a failed recipient cannot be skipped until its result is successfully reported', async () => {
  const f = fixture({
    prepareFails: true,
    reportFailsOnce: true,
    queuedDeliveries: [delivery, { ...delivery, id: 'delivery-2' }],
  });
  await f.start();
  assert.equal(f.state().pendingReport.status, 'FAILED');
  assert.equal(f.state().active, false);
  await f.next();
  assert.deepEqual(f.counts(), { sends: 0, reports: 2, claims: 1 });
  assert.equal(f.state().current, null);
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
