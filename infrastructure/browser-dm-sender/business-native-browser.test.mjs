import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { chromium } from 'playwright-core';

const executablePath =
  process.env.SMGE_TEST_BROWSER ??
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(existsSync);
const pageSource = await readFile(new URL('./page.js', import.meta.url), 'utf8');
const nativeSource = await readFile(new URL('./native-input.js', import.meta.url), 'utf8');

for (const action of ['enter', 'click']) {
  test(
    `native ${action} in an offset Business Suite iframe sends once in an offline fixture`,
    { skip: !executablePath, timeout: 30000 },
    async () => {
      const browser = await chromium.launch({ executablePath, headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        // Intercept every URL, including the fixture's TikTok-shaped origins. No live TikTok traffic.
        await page.route('**/*', (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/business-suite/messages')
            return route.fulfill({
              contentType: 'text/html',
              body: `
            <html><body><nav><a data-e2e="nav-profile" href="/@sender_test">Profile</a></nav>
            <iframe src="/messages" style="position:absolute;left:218px;top:120px;width:1100px;height:563px"></iframe></body></html>`,
            });
          if (path !== '/messages') return route.abort();
          return route.fulfill({
            contentType: 'text/html',
            body: `<html><body>
            <div data-e2e="dm-new-chatbox"><header data-e2e="chat-header"><a href="/@recipient_test"><p data-e2e="chat-uniqueid">@recipient_test</p></a></header>
            <div data-e2e="dm-new-message-list" role="log"></div>
            <div data-e2e="dm-new-input-editor"><div role="textbox" contenteditable="true" class="public-DraftEditor-content" style="border:1px solid;min-height:50px"></div></div>
            ${action === 'click' ? '<button aria-label="Send">Send</button>' : ''}</div>
            <script>
              const editor=document.querySelector('[contenteditable]');
              window.sends=0; window.trusted=false; window.typed=false;
              editor.addEventListener('input', e=>{window.typed=e.isTrusted;});
              const send=e=>{if(!e.isTrusted)return; e.preventDefault(); window.sends++; window.trusted=true;
                const node=document.createElement('p');node.textContent=editor.innerText;
                document.querySelector('[role="log"]').append(node);editor.textContent='';};
              ${action === 'click' ? "document.querySelector('button').addEventListener('click',send);" : "editor.addEventListener('keydown',e=>{if(e.key==='Enter')send(e);});"}
            </script></body></html>`,
          });
        });
        await page.goto('https://www.tiktok.com/business-suite/messages');
        const frame = page.frames().find((item) => new URL(item.url()).pathname === '/messages');
        assert.ok(frame);
        await frame.addScriptTag({ content: pageSource });
        const session = await page.context().newCDPSession(page);
        const context = vm.createContext({
          URL,
          chrome: {
            tabs: { get: async () => ({ url: 'https://www.tiktok.com/business-suite/messages' }) },
            debugger: {
              attach: async () => {},
              detach: async () => session.detach(),
              sendCommand: (_target, method, params) => session.send(method, params),
            },
          },
        });
        vm.runInContext(nativeSource, context);
        const delivery = {
          attemptId: 'offline-business-test',
          username: 'recipient_test',
          senderUsername: 'sender_test',
          message: 'Offline template 👋',
        };
        const result = await context.smgeNativeInput({
          tabId: 1,
          delivery,
          page: (method, item) =>
            frame.evaluate(({ method, item }) => globalThis.smgeDmPage[method](item), {
              method,
              item,
            }),
          authorize: async () => {},
          isActive: async () => true,
        });
        assert.equal(result.status, 'SENT', result.detail);
        const state = await frame.evaluate(() => ({
          sends: window.sends,
          typed: window.typed,
          trusted: window.trusted,
          message: document.querySelector('[role="log"]').innerText.trim(),
        }));
        assert.equal(state.sends, 1);
        assert.equal(state.typed, true);
        assert.equal(state.trusted, true);
        assert.equal(state.message, delivery.message);
      } finally {
        await browser.close();
      }
    },
  );
}
