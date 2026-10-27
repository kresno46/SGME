import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { parseHTML } from 'linkedom';

const source = await readFile(new URL('./diagnostics.js', import.meta.url), 'utf8');
const popup = await readFile(new URL('./popup.js', import.meta.url), 'utf8');

test('Business Suite diagnostics find open shadow DOM and frame origins without exporting private data', () => {
  const { document, window } = parseHTML(`<html><body>
    <div id="host"></div><iframe src="https://im.example.invalid/chat/private-path?token=secret-query#secret-hash"></iframe>
    <iframe src="data:text/html,secret-frame-content"></iframe>
  </body></html>`);
  window.Element.prototype.getClientRects = () => [{}];
  window.Element.prototype.getBoundingClientRect = () => ({ x: 1, y: 2, width: 100, height: 30 });
  const shadow = document.getElementById('host').attachShadow({ mode: 'open' });
  shadow.innerHTML = `<main><header><a href="https://www.tiktok.com/@recipient_test?token=secret-profile">Profile</a></header>
    <div role="log">secret-chat-body</div><textarea placeholder="secret-placeholder">secret-draft</textarea>
    <button>secret-button-text</button></main>`;
  Object.defineProperty(shadow.querySelector('textarea'), 'value', {
    get() {
      throw new Error('Must not read editor value');
    },
  });
  Object.defineProperty(document, 'cookie', {
    get() {
      throw new Error('Must not read cookies');
    },
  });
  for (const frame of document.querySelectorAll('iframe')) {
    Object.defineProperty(frame, 'contentDocument', {
      get() {
        throw new Error('Must not access frame contents');
      },
    });
  }
  const context = vm.createContext({
    document,
    URL,
    location: {
      href: 'https://www.tiktok.com/business-suite/messages?token=secret-page',
      pathname: '/business-suite/messages',
    },
  });
  vm.runInContext(source, context);
  const result = context.smgeDmDiagnose();
  assert.equal(result.path, '/business-suite/messages');
  assert.equal(result.openShadowRoots, 1);
  assert.equal(result.editorCount, 1);
  assert.equal(result.iframeCount, 2);
  assert.equal(result.frames[0].sourceOrigin, 'https://im.example.invalid');
  assert.equal(result.frames[1].sourceOrigin, null);
  assert.ok(result.elements.some((node) => node.profileUsername === 'recipient_test'));
  assert.ok(result.elements.some((node) => node.tag === 'TEXTAREA' && node.parents.length));
  assert.ok(!JSON.stringify(result).includes('secret-'));
  assert.ok(!JSON.stringify(result).includes('private-path'));
});

for (const deniedFrame of [false, true]) {
  test(`popup exports only accessible frames; cross-origin permission denied=${deniedFrame}`, async () => {
    const callbacks = {};
    let blob;
    let downloads = 0;
    const scriptCalls = [];
    const elements = Object.fromEntries(
      ['status', 'start', 'version', 'stop', 'diagnose'].map((id) => [
        id,
        {
          addEventListener: (_event, handler) => {
            callbacks[id] = handler;
          },
        },
      ]),
    );
    class DownloadURL extends URL {
      static createObjectURL(value) {
        blob = value;
        return 'blob:test';
      }
      static revokeObjectURL() {}
    }
    const context = vm.createContext({
      URL: DownloadURL,
      Blob,
      document: {
        getElementById: (id) => elements[id],
        createElement: () => ({
          click() {
            downloads++;
          },
        }),
      },
      chrome: {
        runtime: {
          getManifest: () => ({ version: '0.2.1' }),
          sendMessage: async () => ({ active: false }),
        },
        tabs: {
          query: async () => [
            { id: 10, url: 'https://www.tiktok.com/business-suite/messages?token=private' },
          ],
        },
        scripting: {
          executeScript: async (args) => {
            scriptCalls.push(args);
            if (args.target.allFrames && deniedFrame) throw new Error('Host permission denied');
            if (args.files) return [];
            return [
              { frameId: 0, result: { path: '/business-suite/messages', elements: [] } },
              ...(args.target.allFrames
                ? [{ frameId: 7, result: { path: '/chat', editorCount: 1 } }]
                : []),
            ];
          },
        },
      },
      setInterval() {},
      setTimeout() {},
    });
    vm.runInContext(popup, context);
    await callbacks.diagnose();
    const result = JSON.parse(await blob.text());
    assert.equal(result.format, 'smge-dm-diagnostic-v2');
    assert.equal(result.frameScan, deniedFrame ? 'top-frame-only' : 'accessible-frames');
    assert.equal(result.frames.length, deniedFrame ? 1 : 2);
    assert.equal(downloads, 1);
    assert.ok(
      scriptCalls.filter((args) => args.files).every((args) => args.files[0] === 'diagnostics.js'),
    );
    assert.ok(!JSON.stringify(result).includes('private'));
  });
}
