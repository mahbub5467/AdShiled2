// Runs in YouTube's own page context (world: MAIN). It removes the ad instructions from the
// data YouTube sends to its player, so the player never receives an ad to play.
// YouTube changes this data now and then, so expect to update the key names below.
(() => {
  'use strict';
  if (window.__adshieldYtInstalled) return;
  Object.defineProperty(window, '__adshieldYtInstalled', { value: true });

  let active = true;
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source === window && d && d.source === 'adshield-content' && d.type === 'config') {
      active = !!d.enabled && d.youtube !== false;
    }
  });

  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots'];
  let removedAny = false;

  function strip(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of AD_KEYS) {
      if (key in obj) { delete obj[key]; removedAny = true; }
    }
  }

  function prune(root) {
    if (!active) return root;
    try {
      removedAny = false;
      if (Array.isArray(root)) {
        root.forEach((item) => { strip(item); if (item) strip(item.playerResponse); });
      } else if (root && typeof root === 'object') {
        strip(root);
        strip(root.playerResponse);
      }
      if (removedAny) {
        window.postMessage({ source: 'adshield-main', type: 'blocked', kind: 'youtube', host: '' }, '*');
      }
    } catch (_) {}
    return root;
  }

  // 1. Anything YouTube parses with JSON.parse (XHR, inline data).
  const nativeParse = JSON.parse;
  JSON.parse = function () {
    return prune(nativeParse.apply(this, arguments));
  };

  // 2. Anything YouTube reads with response.json() from its own API.
  const API = /\/youtubei\/v1\/(player|next|get_watch|reel)/;
  const nativeJson = Response.prototype.json;
  Response.prototype.json = function () {
    const result = nativeJson.apply(this, arguments);
    return API.test(this.url || '') ? result.then(prune) : result;
  };

  // 3. The player data written into the page when it first loads.
  try {
    let initial;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: () => initial,
      set: (value) => { initial = prune(value); }
    });
  } catch (_) {}
})();
