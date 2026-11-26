// Facebook: hides "Sponsored" posts in the feed and sponsored blocks in the right column.
// Facebook serves these ads from its own pages and disguises the "Sponsored" label,
// so this works by reading the label, and it will need updating when Facebook changes its markup.
(() => {
  'use strict';

  const LABELS = new Set([
    'sponsored', 'স্পনসর্ড', 'patrocinado', 'publicidad', 'sponsorisé', 'gesponsert',
    'sponsorizzato', 'प्रायोजित', 'ممول', 'bersponsor', 'реклама', 'sponsorlu'
  ]);
  const TARGET = 'sponsored';

  const countLetters = (s) => {
    const m = {};
    for (const ch of s) m[ch] = (m[ch] || 0) + 1;
    return m;
  };
  const TARGET_COUNTS = countLetters(TARGET);

  // Facebook scrambles the label: shuffled letters, hidden decoy letters, text drawn from data-content.
  function labelText(el) {
    const parts = el.querySelectorAll('[data-content]');
    if (parts.length) return Array.from(parts, (n) => n.getAttribute('data-content') || '').join('');
    return el.textContent || '';
  }

  function looksLikeLabel(text) {
    const t = text.replace(/\s+/g, '').toLowerCase();
    if (!t || t.length > TARGET.length + 2) return false;
    if (LABELS.has(t)) return true;
    // Same letters as "sponsored" with at most two extra: catches shuffled labels.
    if (t.length < TARGET.length) return false;
    const c = countLetters(t);
    return Object.keys(TARGET_COUNTS).every((k) => (c[k] || 0) >= TARGET_COUNTS[k]);
  }

  const AD_LINKS = 'a[href*="/ads/about"], a[href*="/ads/preferences"], [aria-label="Sponsored"], [aria-label="স্পনসর্ড"]';

  function isSponsored(unit) {
    if (unit.querySelector(AD_LINKS)) return true;
    const els = unit.querySelectorAll('span, a, b');
    const limit = Math.min(els.length, 150); // the label sits in the post header
    for (let i = 0; i < limit; i++) {
      if (els[i].children.length > 12) continue;
      if (looksLikeLabel(labelText(els[i]))) return true;
    }
    return false;
  }

  let hiddenCount = 0;
  const attempts = new WeakMap();

  function hide(el) {
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute('data-adshield', 'hidden');
    hiddenCount += 1;
  }

  function scanFeed() {
    for (const unit of document.querySelectorAll('[role="feed"] > div')) {
      if (unit.getAttribute('data-adshield')) continue;
      const n = attempts.get(unit) || 0;
      if (n >= 4) continue; // posts load their content late, so check a few times
      attempts.set(unit, n + 1);
      if (isSponsored(unit)) hide(unit);
    }
  }

  function scanRightColumn() {
    for (const rail of document.querySelectorAll('[data-pagelet="RightRail"], [role="complementary"]')) {
      const els = rail.querySelectorAll('h2, h3, span');
      const limit = Math.min(els.length, 200);
      for (let i = 0; i < limit; i++) {
        const el = els[i];
        if (el.closest('[data-adshield]') || el.children.length > 12) continue;
        if (!looksLikeLabel(labelText(el))) continue;

        // Climb to the whole sponsored block, but stop before another section's heading.
        let node = el;
        for (let up = 0; up < 8; up++) {
          const p = node.parentElement;
          if (!p || p === rail) break;
          if (p.querySelectorAll('a[href]').length > 6) break;
          const others = Array.from(p.querySelectorAll('h2, h3')).filter((h) => !h.contains(el) && !el.contains(h));
          if (others.length) break;
          node = p;
        }
        hide(node);
      }
    }
  }

  function scan() {
    const before = hiddenCount;
    scanFeed();
    scanRightColumn();
    if (hiddenCount !== before) {
      __adshield.extra = hiddenCount;
      if (__adshield.report) __adshield.report();
    }
  }

  function start() {
    let timer = 0;
    const schedule = () => {
      if (!timer) timer = setTimeout(() => { timer = 0; scan(); }, 400);
    };
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scan, 2000); // backstop for late-loading labels
  }

  __adshield.settings.then((s) => { if (s.active) start(); });
})();
