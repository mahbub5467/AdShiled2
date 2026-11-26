// AdShield - Isolated World Communication Bridge
// Responsibilities:
// 1. Load and synchronize extension settings.
// 2. Apply website allowlist.
// 3. Communicate with MAIN-world anti-redirect script.
// 4. Relay blocking events to the service worker.

(() => {
    'use strict';

    if (globalThis.__adshieldBridgeInstalled) return;

    globalThis.__adshieldBridgeInstalled = true;

    /* ================= DEFAULT SETTINGS ================= */

    const DEFAULTS = {
        enabled: true,
        blockNotifications: true,
        youtubeSkip: true,
        strictRedirects: true,
        allowlist: [],
        customBlocked: []
    };

    /* ================= SITE DETECTION ================= */

    function getSiteHost() {

        try {

            if (window === window.top) {
                return location.hostname.toLowerCase();
            }

            const origins = location.ancestorOrigins;

            if (origins && origins.length) {

                return new URL(
                    origins[origins.length - 1]
                ).hostname.toLowerCase();
            }

        } catch (_) {}

        return location.hostname.toLowerCase();
    }

    const siteHost = getSiteHost();

    /* ================= SETTINGS HELPERS ================= */

    function normalizeDomain(domain) {

        return String(domain || '')
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split('/')[0]
            .split(':')[0];
    }

    function isAllowed(list) {

        if (!Array.isArray(list)) return false;

        return list.some((domain) => {

            const d = normalizeDomain(domain);

            return d && (
                siteHost === d ||
                siteHost.endsWith('.' + d)
            );
        });
    }

    function derive(settings) {

        const allowlisted = isAllowed(settings.allowlist);

        return {
            ...DEFAULTS,
            ...settings,

            active: Boolean(settings.enabled) && !allowlisted,

            blockNotifications:
                Boolean(settings.blockNotifications),

            youtubeSkip:
                Boolean(settings.youtubeSkip),

            strictRedirects:
                Boolean(settings.strictRedirects)
        };
    }

    /* ================= SETTINGS LOADING ================= */

    async function loadSettings() {

        try {

            const stored = await chrome.storage.local.get(DEFAULTS);

            return derive(stored);

        } catch (error) {

            console.error(
                '[AdShield] Settings loading failed:',
                error
            );

            return derive(DEFAULTS);
        }
    }

    const settings = loadSettings();

    /* ================= GLOBAL CONFIGURATION ================= */

    globalThis.__adshield = {
        settings,
        reload: loadSettings
    };

    /* ================= MAIN WORLD COMMUNICATION ================= */

    function sendConfig(s) {

        window.postMessage({

            source: 'adshield-content',

            type: 'config',

            enabled: s.active,

            strict: s.strictRedirects,

            notifications: s.blockNotifications,

            youtube: s.youtubeSkip

        }, '*');
    }

    settings.then(sendConfig);

    /* ================= SERVICE WORKER COMMUNICATION ================= */

    function sendBlockedEvent(kind, host) {

        try {

            const result = chrome.runtime.sendMessage({

                type: 'blocked',

                kind: String(kind || 'unknown').slice(0, 30),

                host: String(host || '').slice(0, 150)

            });

            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }

        } catch (_) {}
    }

    /* ================= MAIN WORLD MESSAGE LISTENER ================= */

    window.addEventListener('message', (event) => {

        if (event.source !== window) return;

        const data = event.data;

        if (
            !data ||
            data.source !== 'adshield-main'
        ) return;

        if (data.type === 'ready') {

            settings.then(sendConfig);

            return;
        }

        if (data.type === 'blocked') {

            sendBlockedEvent(
                data.kind,
                data.host
            );
        }

    });

    /* ================= SETTINGS SYNCHRONIZATION ================= */

    chrome.storage.onChanged.addListener(async (changes, area) => {

        if (area !== 'local') return;

        const updated = await loadSettings();

        // Update the shared settings Promise.
        globalThis.__adshield.settings = Promise.resolve(updated);

        // Synchronize all isolated-world scripts.
        sendConfig(updated);

    });

    console.log(
        '[AdShield] Communication bridge initialized:',
        siteHost
    );

})();