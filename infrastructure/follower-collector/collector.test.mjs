import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('./collector.js', import.meta.url), 'utf8');

function fixture({
  following = false,
  captcha = false,
  initial = [anchor('https://www.tiktok.com/@calon_1')],
} = {}) {
  let listener;
  let scheduled;
  let anchors = initial;
  const root = {
    isConnected: true,
    scrollHeight: 2000,
    clientHeight: 400,
    getClientRects: () => [1],
    scrollBy: () => {},
    querySelector: (selector) =>
      selector.startsWith('a[')
        ? (anchors[0] ?? null)
        : following
          ? { textContent: 'Following' }
          : null,
    querySelectorAll: (selector) => (selector === '*' ? [] : anchors),
  };
  const context = vm.createContext({
    URL,
    Map,
    Date,
    location: { href: 'https://www.tiktok.com/@solid.mini' },
    document: {
      querySelectorAll: () => [root],
      querySelector: () => (captcha ? {} : null),
    },
    getComputedStyle: () => ({ visibility: 'visible', overflowY: 'auto' }),
    setTimeout: (callback) => {
      scheduled = callback;
      return 1;
    },
    clearTimeout: () => {
      scheduled = undefined;
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener: (callback) => {
            listener = callback;
          },
        },
      },
    },
  });
  vm.runInContext(source, context);
  return {
    root,
    context,
    anchors: (value) => {
      anchors = value;
    },
    next: () => {
      const callback = scheduled;
      scheduled = undefined;
      callback?.();
    },
    command: (action) => {
      let response;
      listener({ source: 'smge-collector', action }, {}, (value) => {
        response = value;
      });
      // Convert cross-realm objects for stable deep equality.
      return JSON.parse(JSON.stringify(response));
    },
  };
}

function anchor(href, text = 'Calon', visible = true) {
  return {
    href,
    textContent: text,
    getAttribute: () => null,
    getClientRects: () => (visible ? [1] : []),
  };
}

test('collects only visible exact TikTok profile links inside the chosen dialog', () => {
  const f = fixture({
    initial: [
      anchor('https://www.tiktok.com/@Calon_1'),
      anchor('https://www.tiktok.com/@calon_1/'),
      anchor('https://www.tiktok.com/@solid.mini'),
      anchor('https://www.tiktok.com/@calon_2/video/123'),
      anchor('https://www.tiktok.com.evil.test/@calon_3'),
      anchor('https://evil.test/@calon_4'),
      anchor('https://www.tiktok.com/@tersembunyi', 'Hidden', false),
    ],
  });
  assert.equal(f.command('start').count, 1);
  assert.match(f.command('export').error, /Hentikan/);
  f.command('stop');
  const { batch } = f.command('export');
  assert.equal(batch.accountUsername, 'solid.mini');
  assert.deepEqual(batch.followers, [{ username: 'calon_1', displayName: 'Calon' }]);
  assert.equal(batch.format, 'smge-followers-v1');
});

test('follows newly rendered rows while scrolling and preserves partial data when dialog closes', () => {
  const f = fixture({ initial: [anchor('https://www.tiktok.com/@calon_1')] });
  f.command('start');
  f.anchors([anchor('https://www.tiktok.com/@calon_2')]);
  f.next();
  assert.equal(f.command('status').count, 2);
  f.root.isConnected = false;
  f.next();
  assert.equal(f.command('status').running, false);
  assert.equal(f.command('export').batch.followers.length, 2);
});

test('rejects explicitly selected Following and a missing dialog', () => {
  assert.match(fixture({ following: true }).command('start').error, /Following/);
  const f = fixture();
  f.root.getClientRects = () => [];
  assert.match(f.command('start').error, /belum ditemukan/);
});

test('stops on a challenge without attempting to bypass it', () => {
  const f = fixture({ captcha: true });
  const state = f.command('start');
  assert.equal(state.running, false);
  assert.match(state.reason, /Verifikasi/);
});

test('caps the batch at 250 and marks it partial', () => {
  const f = fixture({
    initial: Array.from({ length: 260 }, (_, i) => anchor(`https://www.tiktok.com/@calon_${i}`)),
  });
  const state = f.command('start');
  assert.equal(state.count, 250);
  assert.equal(state.running, false);
  assert.match(f.command('export').batch.stopReason, /parsial/);
});

test('stops after repeated idle scans instead of claiming complete results', () => {
  const f = fixture({ initial: [anchor('https://www.tiktok.com/@calon_1')] });
  f.command('start');
  for (let i = 0; i < 5; i++) f.next();
  assert.equal(f.command('status').running, false);
  assert.match(f.command('status').reason, /mungkin parsial/);
});

test('stops when navigating to a different profile and can still export the original batch', () => {
  const f = fixture({ initial: [anchor('https://www.tiktok.com/@calon_1')] });
  f.command('start');
  f.context.location.href = 'https://www.tiktok.com/@akun_lain';
  f.next();
  assert.equal(f.command('status').running, false);
  assert.equal(f.command('export').batch.accountUsername, 'solid.mini');
});

test('reinjection does not install a second collector or discard collected rows', () => {
  const f = fixture({ initial: [anchor('https://www.tiktok.com/@calon_1')] });
  f.command('start');
  vm.runInContext(source, f.context);
  assert.equal(f.command('status').count, 1);
  f.command('stop');
  f.anchors([anchor('https://www.tiktok.com/@calon_2')]);
  f.next();
  assert.equal(f.command('export').batch.followers.length, 1);
});

test('DOM failures stop the job and preserve the previously collected batch', () => {
  const f = fixture();
  f.command('start');
  f.root.querySelectorAll = () => {
    throw new Error('DOM changed');
  };
  f.next();
  assert.equal(f.command('status').running, false);
  assert.match(f.command('status').reason, /gagal dibaca/);
  assert.equal(f.command('export').batch.followers.length, 1);
});
