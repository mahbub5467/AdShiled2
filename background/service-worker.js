'use strict';

/* =====================================================
   ADSHIELD - BACKGROUND SERVICE WORKER
   Chrome Extension Manifest V3
   ===================================================== */

/* ================= DEFAULT SETTINGS ================= */

const DEFAULTS = {
    enabled: true,
    blockNotifications: true,
    youtubeSkip: true,
    strictRedirects: true,
    allowlist: [],
    customBlocked: []
};

const BLOCKED_PAGE = chrome.runtime.getURL('pages/blocked.html');

const SUBRESOURCES = [
    'script',
    'image',
    'sub_frame',
    'xmlhttprequest',
    'ping',
    'media',
    'other'
];

const DOMAIN_RE =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const MAX_CUSTOM_DOMAINS = 100;

const MAX_EVENTS = 8;

/* ================= SERIAL TASK QUEUE ================= */

// Keeps concurrent service-worker operations in order.

let chain = Promise.resolve();

function enqueue(fn) {

    chain = chain
        .then(fn)
        .catch(error => {
            console.error('[AdShield]', error);
        });

    return chain;
}

/* ================= DOMAIN HELPERS ================= */

function normalizeDomain(domain) {

    let value = String(domain || '')
        .trim()
        .toLowerCase();

    value = value.replace(/^https?:\/\//, '');

    value = value.replace(/^www\./, '');

    value = value.split('/')[0];

    value = value.split(':')[0];

    value = value.replace(/\.$/, '');

    return value;
}

function validDomain(domain) {

    return DOMAIN_RE.test(domain);
}

function normalizeDomainList(list) {

    if (!Array.isArray(list)) {
        return [];
    }

    return [...new Set(
        list
            .map(normalizeDomain)
            .filter(validDomain)
    )];
}

/* ================= SETTINGS ================= */

async function getSettings() {

    const stored = await chrome.storage.local.get(DEFAULTS);

    return {
        ...DEFAULTS,
        ...stored,

        enabled: Boolean(stored.enabled),

        blockNotifications:
            Boolean(stored.blockNotifications),

        youtubeSkip:
            Boolean(stored.youtubeSkip),

        strictRedirects:
            Boolean(stored.strictRedirects),

        allowlist:
            normalizeDomainList(stored.allowlist),

        customBlocked:
            normalizeDomainList(stored.customBlocked)
                .slice(0, MAX_CUSTOM_DOMAINS)
    };
}

/* =====================================================
   NOTIFICATION POLICY
   ===================================================== */

async function applyNotificationPolicy(settings) {

    const notificationSettings =
        chrome.contentSettings?.notifications;

    if (!notificationSettings) return;

    await notificationSettings.clear({});

    if (
        !settings.enabled ||
        !settings.blockNotifications
    ) {
        return;
    }

    await notificationSettings.set({

        primaryPattern: '<all_urls>',

        setting: 'block'

    });

    // Restore normal notification permission
    // for allowlisted websites.

    for (const host of settings.allowlist) {

        await notificationSettings.set({

            primaryPattern: `*://${host}/*`,

            setting: 'ask'

        });

        await notificationSettings.set({

            primaryPattern: `*://*.${host}/*`,

            setting: 'ask'

        });
    }
}

/* =====================================================
   DYNAMIC DNR RULE GENERATION
   ===================================================== */

function buildDynamicRules(settings) {

    const rules = [];

    /*
       ALLOWLIST

       Priority 100 ensures allowlisted site
       navigation is not affected by static
       advertising rules.

       allowAllRequests applies to requests
       associated with the allowed frame.
    */

    settings.allowlist.forEach((host, index) => {

        rules.push({

            id: index + 1,

            priority: 100,

            action: {
                type: 'allowAllRequests'
            },

            condition: {

                requestDomains: [host],

                resourceTypes: [
                    'main_frame',
                    'sub_frame'
                ]

            }

        });

    });

    /*
       CUSTOM BLOCKED DOMAINS
    */

    if (!settings.enabled) {
        return rules;
    }

    const customDomains = settings.customBlocked.filter(
        domain => validDomain(domain)
    );

    if (!customDomains.length) {
        return rules;
    }

    rules.push({

        id: 1000,

        priority: 50,

        action: {
            type: 'block'
        },

        condition: {

            requestDomains: customDomains,

            resourceTypes: SUBRESOURCES

        }

    });

    rules.push({

        id: 1001,

        priority: 50,

        action: {
            type: 'redirect',

            redirect: {
                extensionPath: '/pages/blocked.html'
            }
        },

        condition: {

            requestDomains: customDomains,

            resourceTypes: [
                'main_frame'
            ]

        }

    });

    return rules;
}

/* =====================================================
   APPLY EXTENSION STATE
   ===================================================== */

async function syncState() {

    const settings = await getSettings();

    /*
       STATIC RULESET
    */

    const rulesets = await chrome.declarativeNetRequest
        .getEnabledRulesets();

    if (settings.enabled && !rulesets.includes('ads')) {

        await chrome.declarativeNetRequest
            .updateEnabledRulesets({

                enableRulesetIds: ['ads']

            });

    } else if (
        !settings.enabled &&
        rulesets.includes('ads')
    ) {

        await chrome.declarativeNetRequest
            .updateEnabledRulesets({

                disableRulesetIds: ['ads']

            });
    }

    /*
       BADGE CONFIGURATION
    */

    await chrome.declarativeNetRequest
        .setExtensionActionOptions({

            displayActionCountAsBadgeText: true

        });

    await chrome.action.setBadgeBackgroundColor({

        color: '#0B7A5E'

    });

    /*
       DYNAMIC RULES
    */

    const newRules = buildDynamicRules(settings);

    const oldRules = await chrome.declarativeNetRequest
        .getDynamicRules();

    await chrome.declarativeNetRequest.updateDynamicRules({

        removeRuleIds: oldRules.map(rule => rule.id),

        addRules: newRules

    });

    /*
       NOTIFICATION POLICY
    */

    await applyNotificationPolicy(settings);

    console.log(
        '[AdShield] Settings synchronized.',
        {
            enabled: settings.enabled,
            allowlist: settings.allowlist.length,
            customBlocked: settings.customBlocked.length
        }
    );
}

/* =====================================================
   INSTALLATION AND STARTUP
   ===================================================== */

chrome.runtime.onInstalled.addListener(() => {

    enqueue(async () => {

        const settings = await getSettings();

        await chrome.storage.local.set(settings);

        await syncState();

        console.log('[AdShield] Installed successfully.');

    });

});

chrome.runtime.onStartup.addListener(() => {

    enqueue(syncState);

});

/* =====================================================
   SETTINGS CHANGE LISTENER
   ===================================================== */

chrome.storage.onChanged.addListener((changes, area) => {

    if (area !== 'local') return;

    enqueue(syncState);

});

/* =====================================================
   PER-TAB COUNTERS
   ===================================================== */

const countsKey = tabId => `counts:${tabId}`;

async function updateCounts(tabId, mutate) {

    const key = countsKey(tabId);

    const stored = await chrome.storage.session.get(key);

    const counts = stored[key] || {};

    counts.cosmetic = counts.cosmetic || {};

    counts.hijacks = counts.hijacks || 0;

    counts.youtube = counts.youtube || 0;

    counts.events = counts.events || [];

    mutate(counts);

    await chrome.storage.session.set({

        [key]: counts

    });
}

/* =====================================================
   BLOCKED EVENT HISTORY
   ===================================================== */

function recordEvent(counts, kind, host) {

    const normalizedKind = String(kind || 'unknown')
        .slice(0, 30);

    const normalizedHost = String(host || '')
        .slice(0, 150);

    const exists = counts.events.some(event =>

        event.kind === normalizedKind &&
        event.host === normalizedHost

    );

    if (exists) return;

    counts.events.unshift({

        kind: normalizedKind,

        host: normalizedHost,

        time: Date.now()

    });

    counts.events.length = Math.min(
        counts.events.length,
        MAX_EVENTS
    );
}

/* =====================================================
   MESSAGE HANDLER
   ===================================================== */

chrome.runtime.onMessage.addListener((message, sender) => {

    const tabId = sender.tab?.id;

    if (tabId == null || !message) {
        return;
    }

    /*
       COSMETIC BLOCKING COUNTER
    */

    if (message.type === 'cosmetic') {

        const count = Math.max(
            0,
            Math.min(5000, Number(message.count) || 0)
        );

        const frameId = sender.frameId ?? 0;

        enqueue(() => updateCounts(tabId, counts => {

            counts.cosmetic[frameId] = count;

        }));

        return;
    }

    /*
       BLOCKED EVENT
    */

    if (message.type === 'blocked') {

        const kind = String(message.kind || 'unknown')
            .slice(0, 30);

        const host = String(message.host || '')
            .slice(0, 150);

        enqueue(() => updateCounts(tabId, counts => {

            if (kind === 'youtube') {

                counts.youtube += 1;

            } else {

                counts.hijacks += 1;

                recordEvent(
                    counts,
                    kind,
                    host
                );

            }

        }));

    }

});

/* =====================================================
   TAB NAVIGATION
   ===================================================== */

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {

    /*
       RESET COUNTERS ON NEW PAGE LOAD
    */

    if (info.status === 'loading') {

        enqueue(async () => {

            await chrome.storage.session.remove(
                countsKey(tabId)
            );

        });

    }

    /*
       POPUP / POPUNDER DETECTION

       A new tab redirected to our blocked page
       is closed and credited to its opener.
    */

    if (
        info.url &&
        info.url.startsWith(BLOCKED_PAGE) &&
        tab.openerTabId != null
    ) {

        const opener = tab.openerTabId;

        enqueue(() => updateCounts(opener, counts => {

            counts.hijacks += 1;

            recordEvent(
                counts,
                'popup',
                ''
            );

        }));

        chrome.tabs.remove(tabId).catch(() => {});

    }

});

/* =====================================================
   TAB CLEANUP
   ===================================================== */

chrome.tabs.onRemoved.addListener(tabId => {

    enqueue(async () => {

        await chrome.storage.session.remove(
            countsKey(tabId)
        );

    });

});

/* =====================================================
   INITIALIZATION
   ===================================================== */

enqueue(syncState);

console.log('[AdShield] Service worker initialized.');