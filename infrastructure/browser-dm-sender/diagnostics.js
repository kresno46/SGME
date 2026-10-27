// Read-only DOM inspection. Does not select chats, type, send, or read app/network state.
globalThis.smgeDmDiagnose = function () {
  const visible = (node) => node.getClientRects().length > 0;
  const roots = [document];
  for (let i = 0; i < roots.length && roots.length < 50; i++) {
    for (const node of roots[i].querySelectorAll('*')) {
      if (node.shadowRoot && roots.length < 50) roots.push(node.shadowRoot);
    }
  }
  const find = (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]);
  const describe = (node) => {
    const rect = node.getBoundingClientRect();
    const attr = (key) => (node.getAttribute(key) ?? '').slice(0, 160);
    return {
      tag: node.tagName,
      e2e: attr('data-e2e'),
      role: attr('role'),
      classes: attr('class'),
      editable: attr('contenteditable'),
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  };
  const parents = (node) => {
    const result = [];
    let parent = node.parentElement ?? node.getRootNode?.().host;
    while (parent && result.length < 8) {
      result.push(describe(parent));
      parent = parent.parentElement ?? parent.getRootNode?.().host;
    }
    return result;
  };
  const profile = (node) => {
    if (node.tagName !== 'A') return undefined;
    try {
      const url = new URL(node.getAttribute('href'), location.href);
      return url.origin === 'https://www.tiktok.com'
        ? /^\/@([a-z0-9._]{2,24})\/?$/i.exec(url.pathname)?.[1].toLowerCase()
        : undefined;
    } catch {
      return undefined;
    }
  };
  const editors = find('textarea, input[placeholder], [contenteditable="true"], [role="textbox"]');
  const markers = find(
    '[data-e2e], [role="dialog"], [role="log"], [role="main"], main, header, nav, button, [role="button"], a[href*="/@"]',
  );
  const candidates = [...new Set([...editors, ...markers])].filter(visible);
  const frames = find('iframe, frame')
    .slice(0, 30)
    .map((node) => {
      let sourceOrigin = null;
      try {
        const url = new URL(node.getAttribute('src') || '', location.href);
        if (['http:', 'https:'].includes(url.protocol)) sourceOrigin = url.origin;
      } catch {
        /* Never export raw URLs, query strings, or frame content. */
      }
      return { ...describe(node), sourceOrigin };
    });
  const handles = find('a, span, p, div')
    .filter(visible)
    .filter((node) => /^@[a-z0-9._]{2,24}$/i.test((node.textContent ?? '').trim()))
    .slice(0, 40)
    .map((node) => ({
      ...describe(node),
      handle: node.textContent.trim().toLowerCase(),
      parents: parents(node),
    }));
  return {
    path: location.pathname,
    readyState: document.readyState,
    openShadowRoots: roots.length - 1,
    editorCount: editors.filter(visible).length,
    candidateCount: candidates.length,
    iframeCount: find('iframe, frame').length,
    frames,
    elements: candidates.slice(0, 200).map((node) => ({
      ...describe(node),
      ...(profile(node) ? { profileUsername: profile(node) } : {}),
      parents: parents(node),
    })),
    handles,
  };
};
