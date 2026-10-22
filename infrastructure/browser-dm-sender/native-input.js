// Native browser input only. No private TikTok requests, state mutation via React
// internals, or fallback resend after an uncertain Enter/click.
globalThis.smgeNativeInput = async function ({ tabId, delivery, page, authorize, isActive }) {
  const target = { tabId };
  let attached = false;
  let attempted = false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (new URL(tab.url).origin !== 'https://www.tiktok.com')
      throw new Error('Tab pengiriman bukan TikTok.');
    try {
      await chrome.debugger.attach(target, '1.3');
      attached = true;
    } catch (error) {
      throw new Error(
        `Kontrol input browser gagal. Pastikan izin debugger aktif dan tutup DevTools pada tab TikTok. ${error.message}`,
        { cause: error },
      );
    }
    if (!(await isActive())) throw new Error('Dihentikan operator sebelum mengetik.');
    const focused = await page('focus', delivery);
    if (!focused.focused) return focused;
    await chrome.debugger.sendCommand(target, 'Input.insertText', { text: delivery.message });
    let ready = await page('inspect', delivery);
    if (!ready.ready) return ready;
    await authorize();
    if (!(await isActive())) throw new Error('Dihentikan operator; template masih berupa draft.');
    ready = await page('inspect', delivery);
    if (!ready.ready) return ready;
    attempted = true;
    if (ready.action.kind === 'enter') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        text: '\r',
        unmodifiedText: '\r',
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
    } else if (ready.action.kind === 'click') {
      const coordinates = { x: ready.action.x, y: ready.action.y, button: 'left', clickCount: 1 };
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...coordinates,
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...coordinates,
      });
    } else throw new Error('Kontrol kirim tidak dikenali.');
    return await page('observe', delivery);
  } catch (error) {
    return { status: attempted ? 'UNVERIFIED' : 'FAILED', detail: error.message };
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch {
        /* Tab closed or debugger detached by user. */
      }
    }
  }
};
