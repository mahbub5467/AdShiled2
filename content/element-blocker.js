// AdShield - Cosmetic Filtering Engine
// Hides advertisement containers, banners, floating ads,
// suspicious overlays and advertising iframes.

(() => {
    'use strict';

    const ext = globalThis.browser ?? globalThis.chrome;

    if (!ext?.runtime) return;

    if (globalThis.__adshieldElementBlockerInstalled) return;

    globalThis.__adshieldElementBlockerInstalled = true;

    /* ================= CONFIGURATION ================= */

    const SELECTORS = [
        'ins.adsbygoogle',
        '.adsbygoogle',
        '[id^="div-gpt-ad"]',
        '[id^="google_ads_iframe"]',
        '[id*="google_ads"]',
        '[data-ad-slot]',
        '[data-ad-client]',
        '[aria-label="Advertisement"]',
        '[aria-label="advertisement"]',

        '.ad-banner',
        '.ad-container',
        '.ad-wrapper',
        '.advertisement',
        '.advert',
        '.banner-ads',
        '.sticky-ad',
        '.floating-ad',
        '.ad-overlay',
        '.ad-popup',

        '#ad-banner',
        '#ad_banner',

        'iframe[src*="doubleclick.net"]',
        'iframe[src*="googlesyndication.com"]',
        'iframe[src*="adservice.google"]',
        'iframe[src*="taboola.com"]',
        'iframe[src*="outbrain.com"]'
    ];

    const SELECTOR = SELECTORS.join(',');

    const IS_YOUTUBE =
        /(^|\.)youtube\.com$/i.test(location.hostname) ||
        /(^|\.)youtu\.be$/i.test(location.hostname);

    const AD_WORD =
        /(^|[\s_-])(ad|ads|adv|advert|advertisement|adslot|sponsored|interstitial)([\s_-]|$)/i;

    const AD_HOST =
        /doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|taboola\.com|outbrain\.com|popads\.net|propellerads\.com|adsterra\.com|exoclick\.com/i;

    /* ================= STATE ================= */

    let enabled = false;

    let observer = null;
    let timer = null;

    let hiddenCount = 0;
    let lastSent = -1;

    const hiddenElements = new Set();
    const originalStyles = new WeakMap();

    let styleElement = null;

    /* ================= HELPERS ================= */

    function isElement(node) {
        return node instanceof HTMLElement;
    }

    function hasAdSignature(el) {

        const label = [
            el.id || '',
            typeof el.className === 'string' ? el.className : ''
        ].join(' ');

        if (AD_WORD.test(label)) {
            return true;
        }

        const frames = [];

        if (el.tagName === 'IFRAME') {
            frames.push(el);
        } else {
            frames.push(...el.querySelectorAll('iframe[src]'));
        }

        return frames.some(frame => AD_HOST.test(frame.src));
    }

    function isYouTube() {
        return IS_YOUTUBE;
    }

    /* ================= CSS INJECTION ================= */

    function injectStyle() {

        if (styleElement?.isConnected) return;

        if (document.getElementById('adshield-style')) {
            styleElement = document.getElementById('adshield-style');
            return;
        }

        styleElement = document.createElement('style');

        styleElement.id = 'adshield-style';

        styleElement.textContent = `
            ${SELECTOR} {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
        `;

        (document.head || document.documentElement)
            .appendChild(styleElement);
    }

    /* ================= HIDE ELEMENT ================= */

    function hide(el) {

        if (!isElement(el)) return;

        if (hiddenElements.has(el)) return;

        originalStyles.set(el, {
            display: el.style.getPropertyValue('display'),
            priority: el.style.getPropertyPriority('display')
        });

        el.style.setProperty(
            'display',
            'none',
            'important'
        );

        hiddenElements.add(el);

        hiddenCount++;
    }

    /* ================= RESTORE ELEMENT ================= */

    function restore(el) {

        if (!hiddenElements.has(el)) return;

        const original = originalStyles.get(el);

        if (original) {

            if (original.display) {

                el.style.setProperty(
                    'display',
                    original.display,
                    original.priority
                );

            } else {

                el.style.removeProperty('display');
            }
        }

        hiddenElements.delete(el);

        hiddenCount = Math.max(0, hiddenCount - 1);
    }

    /* ================= OVERLAY DETECTION ================= */

    function evaluate(el) {

        if (!enabled || isYouTube()) return;

        if (!isElement(el)) return;

        if (
            el.id === 'adshield-style' ||
            el.closest('#adshield-style')
        ) return;

        if (el.closest('[data-adshield-protected]')) return;

        if (hiddenElements.has(el)) return;

        const cs = getComputedStyle(el);

        if (
            cs.position !== 'fixed' &&
            cs.position !== 'sticky'
        ) return;

        if (cs.display === 'none') return;

        const rect = el.getBoundingClientRect();

        const coversMost =
            rect.width >= innerWidth * 0.6 &&
            rect.height >= innerHeight * 0.6;

        const transparent =
            cs.backgroundColor === 'rgba(0, 0, 0, 0)' ||
            cs.backgroundColor === 'transparent';

        const empty =
            !el.textContent.trim() &&
            !el.querySelector(
                'img,video,canvas,svg,input,button'
            );

        // Detect suspicious invisible click-trap overlays.
        if (
            coversMost &&
            (
                parseFloat(cs.opacity) < 0.05 ||
                (transparent && empty)
            )
        ) {

            hide(el);

            return;
        }

        // Detect fixed/sticky advertisement containers.
        if (
            hasAdSignature(el) &&
            !el.querySelector('video')
        ) {

            hide(el);
        }
    }

    /* ================= DOM SCANNING ================= */

    function evaluateWithChildren(el) {

        if (!isElement(el)) return;

        evaluate(el);

        if (el.matches(SELECTOR)) {
            hide(el);
        }

        for (const child of el.children) {

            evaluate(child);

            if (child.matches(SELECTOR)) {
                hide(child);
            }
        }
    }

    function scanDocument() {

        if (!enabled || isYouTube()) return;

        document.querySelectorAll(SELECTOR).forEach(hide);

        if (document.body) {

            for (const child of document.body.children) {
                evaluateWithChildren(child);
            }
        }

        report();
    }

    /* ================= BLOCK COUNTER ================= */

    function report() {

        if (!enabled) return;

        const matched = document.querySelectorAll(
            SELECTOR
        );

        // Count unique matching and manually hidden elements.
        const unique = new Set(matched);

        for (const el of hiddenElements) {

            if (el.isConnected) {
                unique.add(el);
            }
        }

        const count = unique.size + (globalThis.__adshield?.extra || 0);

        if (count === lastSent) return;

        lastSent = count;

        try {

            const result = ext.runtime.sendMessage({

                type: 'cosmetic',

                count

            });

            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }

        } catch (_) {}
    }

    /* ================= GLOBAL REPORT API ================= */

    if (globalThis.__adshield) {

        globalThis.__adshield.report = report;
    }

    /* ================= MUTATION OBSERVER ================= */

    const pendingNodes = new Set();

    function startObserver() {

        if (observer || !document.documentElement) return;

        observer = new MutationObserver((mutations) => {

            for (const mutation of mutations) {

                for (const node of mutation.addedNodes) {

                    if (node.nodeType === Node.ELEMENT_NODE) {
                        pendingNodes.add(node);
                    }
                }
            }

            if (!pendingNodes.size || timer) return;

            timer = setTimeout(() => {

                timer = null;

                const batch = [...pendingNodes];

                pendingNodes.clear();

                for (const el of batch) {

                    if (el.isConnected) {
                        evaluateWithChildren(el);
                    }
                }

                report();

            }, 150);

        });

        observer.observe(document.documentElement, {

            childList: true,

            subtree: true

        });
    }

    /* ================= STOP ENGINE ================= */

    function stop() {

        enabled = false;

        if (observer) {

            observer.disconnect();

            observer = null;
        }

        if (timer) {

            clearTimeout(timer);

            timer = null;
        }

        for (const el of [...hiddenElements]) {
            restore(el);
        }

        if (styleElement) {

            styleElement.remove();

            styleElement = null;
        }

        hiddenCount = 0;

        lastSent = -1;
    }

    /* ================= START ENGINE ================= */

    function start() {

        if (enabled || isYouTube()) return;

        enabled = true;

        injectStyle();

        scanDocument();

        startObserver();

        console.log('[AdShield] Cosmetic filtering enabled.');
    }

    /* ================= SETTINGS SYNCHRONIZATION ================= */

    async function initialize() {

        if (!globalThis.__adshield?.settings) {

            console.warn('[AdShield] Settings unavailable.');

            return;
        }

        try {

            const settings = await globalThis.__adshield.settings;

            if (settings.active) {
                start();
            }

        } catch (error) {

            console.error(
                '[AdShield] Initialization failed:',
                error
            );
        }
    }

    initialize();

    // React to settings changes from the storage bridge.
    chrome.storage.onChanged.addListener(async (changes, area) => {

        if (area !== 'local') return;

        try {

            const settings = await chrome.storage.local.get({
                enabled: true,
                allowlist: []
            });

            const host = location.hostname.toLowerCase();

            const allowed = Array.isArray(settings.allowlist) &&
                settings.allowlist.some(domain => {

                    const d = String(domain)
                        .trim()
                        .toLowerCase()
                        .replace(/^www\./, '');

                    return d && (
                        host === d ||
                        host.endsWith('.' + d)
                    );
                });

            const shouldEnable =
                Boolean(settings.enabled) &&
                !allowed;

            if (shouldEnable) {
                start();
            } else {
                stop();
            }

        } catch (error) {

            console.error(
                '[AdShield] Settings synchronization failed:',
                error
            );
        }

    });

    console.log('[AdShield] Element blocker loaded.');

})();