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
const delivery = {
  attemptId: 'offline-attempt',
  username: 'recipient_test',
  senderUsername: 'sender_test',
  message: 'Halo 👋 dari template.\nBaris kedua.',
};

test(
  'personal profile and editor can load late without premature failure or duplicate clicks',
  { skip: !executablePath, timeout: 30000 },
  async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.route('**/*', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<html><body><script>
        window.opens=0;window.sends=0;window.typed=false;
        setTimeout(()=>{
          document.body.insertAdjacentHTML('beforeend','<a data-e2e="nav-profile" href="/@sender_test">Profile</a><button data-e2e="message-button">Message</button>');
          document.querySelector('button').addEventListener('click',()=>{
            window.opens++;
            document.body.insertAdjacentHTML('beforeend','<div data-e2e="dm-new-chatbox"><header data-e2e="chat-header"><a href="/@recipient_test">Recipient</a></header><div data-e2e="dm-new-message-list" role="log"></div><div data-e2e="dm-new-input-editor"></div></div>');
            setTimeout(()=>{
              const box=document.querySelector('[data-e2e="dm-new-input-editor"]');
              box.innerHTML='<div contenteditable="true" role="textbox" class="public-DraftEditor-content" style="border:1px solid;min-height:50px"></div>';
              const editor=box.firstChild;
              editor.addEventListener('input',e=>{window.typed=e.isTrusted;});
              editor.addEventListener('keydown',e=>{if(e.key!=='Enter'||!e.isTrusted)return;e.preventDefault();window.sends++;
                const bubble=document.createElement('p');bubble.style.whiteSpace='pre-wrap';bubble.textContent=editor.innerText;
                document.querySelector('[role="log"]').append(bubble);editor.textContent='';});
            },2500);
          });
        },3000);
      </script></body></html>`,
        }),
      );
      await page.goto('https://www.tiktok.com/@recipient_test');
      await page.addScriptTag({ content: pageSource });
      assert.equal(
        (await page.evaluate((item) => globalThis.smgeDmPage.open(item), delivery)).opened,
        true,
      );
      assert.equal(
        (await page.evaluate((item) => globalThis.smgeDmPage.prepare(item), delivery)).ready,
        true,
      );
      const session = await page.context().newCDPSession(page);
      const context = vm.createContext({
        URL,
        chrome: {
          tabs: { get: async () => ({ url: 'https://www.tiktok.com/messages' }) },
          debugger: {
            attach: async () => {},
            detach: async () => session.detach(),
            sendCommand: (_target, method, params) => session.send(method, params),
          },
        },
      });
      vm.runInContext(nativeSource, context);
      const result = await context.smgeNativeInput({
        tabId: 1,
        delivery,
        page: (method, item) =>
          page.evaluate(({ method, item }) => globalThis.smgeDmPage[method](item), {
            method,
            item,
          }),
        authorize: async () => {},
        isActive: async () => true,
      });
      assert.equal(result.status, 'SENT', result.detail);
      const state = await page.evaluate(() => ({
        opens: window.opens,
        sends: window.sends,
        typed: window.typed,
        message: document.querySelector('[role="log"]').innerText.trim(),
      }));
      assert.equal(state.opens, 1);
      assert.equal(state.sends, 1);
      assert.equal(state.typed, true);
      assert.equal(state.message, delivery.message);
    } finally {
      await browser.close();
    }
  },
);

test(
  'real Chromium focuses via a native click when editor.focus() does nothing, then types and sends once',
  { skip: !executablePath, timeout: 30000 },
  async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage();
      // No TikTok connection, saved credentials, or real recipients. Block all network.
      await page.route('**/*', (route) => route.abort());
      await page.setContent(`<!doctype html><html><body>
      <a data-e2e="nav-profile" href="https://www.tiktok.com/@sender_test">Profile</a>
      <div data-e2e="dm-new-chatbox"><div class="css-test--DivChatHeader edjqxpv1"><a href="https://www.tiktok.com/@recipient_test"><p data-e2e="chat-uniqueid">@recipient_test</p></a></div>
      <div data-e2e="dm-new-message-list" role="log"></div>
      <div data-e2e="dm-new-input-editor"><div contenteditable="true" role="textbox" class="public-DraftEditor-content" style="border:1px solid;width:600px;min-height:40px"></div></div></div>
      <script>
        const editor = document.querySelector('[contenteditable]');
        editor.focus = () => {};
        window.focusClicks = 0;
        editor.addEventListener('mousedown', event => { if(event.isTrusted)window.focusClicks++; });
        window.acceptedText = ''; window.trustedInput = false; window.trustedSend = false;
        editor.addEventListener('input', (event) => {
          if (!event.isTrusted) { editor.textContent = ''; window.acceptedText = ''; return; }
          window.trustedInput = true; window.acceptedText = editor.innerText;
        });
        editor.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' || !event.isTrusted) return;
          event.preventDefault(); window.trustedSend = true;
          const bubble = document.createElement('p'); bubble.style.whiteSpace = 'pre-wrap'; bubble.textContent = window.acceptedText;
          document.querySelector('[role="log"]').append(bubble); editor.textContent = '';
        });
      </script></body></html>`);
      await page.addScriptTag({ content: pageSource });
      const session = await page.context().newCDPSession(page);
      const context = vm.createContext({
        URL,
        chrome: {
          tabs: { get: async () => ({ url: 'https://www.tiktok.com/messages' }) },
          debugger: {
            attach: async () => {},
            detach: async () => session.detach(),
            sendCommand: (_target, method, parameters) => session.send(method, parameters),
          },
        },
      });
      vm.runInContext(nativeSource, context);
      const result = await context.smgeNativeInput({
        tabId: 1,
        delivery,
        page: (method, item) =>
          page.evaluate(({ method, item }) => globalThis.smgeDmPage[method](item), {
            method,
            item,
          }),
        authorize: async () => {},
        isActive: async () => true,
      });
      assert.equal(result.status, 'SENT', result.detail);
      const state = await page.evaluate(() => ({
        typed: window.trustedInput,
        focusClicks: window.focusClicks,
        sent: window.trustedSend,
        message: document.querySelector('[role="log"]').innerText,
      }));
      assert.equal(state.typed, true);
      assert.equal(state.focusClicks, 1);
      assert.equal(state.sent, true);
      assert.equal(state.message.trim(), delivery.message);
    } finally {
      await browser.close();
    }
  },
);
