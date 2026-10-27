import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8');

function fixture(responses, { missingInjection = false } = {}) {
  const calls = [];
  const document = { cookie: 'smge_csrf=before-refresh' };
  const context = vm.createContext({
    URL,
    document,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error('Unexpected request');
      if (url === '/api/auth/refresh' && response.status === 200)
        document.cookie = 'smge_csrf=after-refresh';
      return new Response(response.body ?? '', { status: response.status });
    },
    chrome: {
      tabs: { get: async () => ({ url: 'http://localhost:3000/outbound' }) },
      scripting: {
        executeScript: async ({ func, args }) =>
          missingInjection ? [{}] : [{ result: await func(...args) }],
      },
      alarms: { onAlarm: { addListener() {} } },
      runtime: { onMessage: { addListener() {} } },
    },
  });
  vm.runInContext(source, context);
  return {
    calls,
    request: () =>
      context.api({ dashboardTabId: 1, origin: 'http://localhost:3000' }, 'claim', {
        accountId: 'test',
        clientId: 'test-client',
      }),
  };
}

test('empty successful claim response means no queued delivery, not an authentication error', async () => {
  const f = fixture([{ status: 201, body: '' }]);
  assert.equal(await f.request(), null);
  assert.equal(f.calls.length, 1);
});
test('parses JSON successes and preserves the real HTTP error message/status', async () => {
  const success = fixture([{ status: 201, body: '{"id":"delivery-1"}' }]);
  assert.equal((await success.request()).id, 'delivery-1');
  const failure = fixture([{ status: 403, body: '{"message":"Token CSRF tidak valid"}' }]);
  await assert.rejects(
    failure.request(),
    (error) => error.status === 403 && /CSRF/.test(error.message),
  );
});
test('refreshes an expired session once and uses the rotated CSRF cookie on retry', async () => {
  const f = fixture([{ status: 401 }, { status: 200, body: '{"ok":true}' }, { status: 201 }]);
  assert.equal(await f.request(), null);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[1].url, '/api/auth/refresh');
  assert.equal(f.calls[0].init.headers['X-CSRF-Token'], 'before-refresh');
  assert.equal(f.calls[2].init.headers['X-CSRF-Token'], 'after-refresh');
});
test('does not retry network failures and does not describe them as expired login', async () => {
  const f = fixture([new Error('Network failure')]);
  await assert.rejects(
    f.request(),
    (error) => error.status === 0 && /Koneksi API/.test(error.message),
  );
  assert.equal(f.calls.length, 1);
});
test('requires login only when session refresh fails', async () => {
  const f = fixture([{ status: 401 }, { status: 401 }]);
  await assert.rejects(
    f.request(),
    (error) => error.status === 401 && /Login ulang/.test(error.message),
  );
  assert.equal(f.calls.length, 2);
});
test('HTML and absent injection results have distinct actionable errors', async () => {
  await assert.rejects(
    fixture([{ status: 200, body: '<html>Sign in</html>' }]).request(),
    /bukan JSON/,
  );
  await assert.rejects(fixture([], { missingInjection: true }).request(), /tidak menerima hasil/);
});
