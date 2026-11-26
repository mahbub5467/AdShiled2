
'use strict';

/* =========================================
   ADSHIELD POPUP
   ========================================= */

const DEFAULTS = {
    enabled: true,
    blockNotifications: true,
    youtubeSkip: true,
    strictRedirects: true,
    allowlist: [],
    customBlocked: []
};

const DOMAIN_RE =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const KIND = {
    redirect: 'Redirect',
    popup: 'Pop-up',
    hijack: 'Hijacked click',
    overlay: 'Overlay'
};

const $ = selector => document.querySelector(selector);

let tab = null;
let host = '';
let initialized = false;

/* =========================================
   HELPERS
   ========================================= */

function normalizeDomain(raw) {
    let value = String(raw || '').trim().toLowerCase();

    try {
        const url = new URL(
            value.includes('://') ? value : `http://${value}`
        );

        if (!['http:', 'https:'].includes(url.protocol)) {
            return '';
        }

        value = url.hostname.toLowerCase();

    } catch (_) {
        return '';
    }

    return value.replace(/^www\./, '').replace(/\.$/, '');
}

function covers(list, domain) {
    return Array.isArray(list) &&
        !!domain &&
        list.some(d =>
            domain === d || domain.endsWith('.' + d)
        );
}

function siteHost(url) {
    try {
        const u = new URL(url);

        if (!['http:', 'https:'].includes(u.protocol)) {
            return '';
        }

        return u.hostname
            .replace(/^www\./, '')
            .toLowerCase();

    } catch (_) {
        return '';
    }
}

function normalizeList(list) {
    if (!Array.isArray(list)) return [];

    return [...new Set(
        list.map(normalizeDomain).filter(Boolean)
            .filter(d => DOMAIN_RE.test(d))
    )];
}

const getSettings = async () => {
    const stored = await chrome.storage.local.get(DEFAULTS);

    return {
        ...DEFAULTS,
        ...stored,
        allowlist: normalizeList(stored.allowlist),
        customBlocked: normalizeList(stored.customBlocked)
    };
};

async function save(patch) {
    await chrome.storage.local.set(patch);
}

/* =========================================
   NETWORK BLOCKING COUNTER
   ========================================= */

async function networkCount(tabId) {
    let matched = 0;
    let badge = 0;

    try {
        const result =
            await chrome.declarativeNetRequest.getMatchedRules({
                tabId
            });

        matched = (result.rulesMatchedInfo || [])
            .filter(item => item.rule.rulesetId === 'ads')
            .length;

    } catch (_) {}

    try {
        const text = await chrome.action.getBadgeText({
            tabId
        });

        badge = parseInt(text, 10) || 0;

    } catch (_) {}

    return Math.max(matched, badge);
}

/* =========================================
   PAGE STATISTICS
   ========================================= */

async function pageData(tabId) {
    const net = await networkCount(tabId);

    const key = `counts:${tabId}`;

    const stored = await chrome.storage.session.get(key);

    const counts = stored[key] || {};

    const dom = Object.values(counts.cosmetic || {})
        .reduce((sum, value) => sum + (Number(value) || 0), 0);

    return {
        net,
        dom,
        hij: Number(counts.hijacks) || 0,
        yt: Number(counts.youtube) || 0,
        events: counts.events || []
    };
}

/* =========================================
   RENDER STATISTICS
   ========================================= */

function renderCounts(counts) {
    const keys = ['net', 'dom', 'hij', 'yt'];

    const total = keys.reduce(
        (sum, key) => sum + (Number(counts[key]) || 0),
        0
    );

    $('#total').textContent = total.toLocaleString();

    const bar = $('#bar');

    for (const key of keys) {
        const value = Number(counts[key]) || 0;

        $(`#n-${key}`).textContent = value.toLocaleString();

        const segment = $(`#seg-${key}`);

        segment.style.flexGrow = String(value);
        segment.style.display = value > 0 ? '' : 'none';
    }

    bar.hidden = total === 0;
}

/* =========================================
   ADD CUSTOM BLOCKED DOMAIN
   ========================================= */

async function addBlockedDomain(raw) {
    const domain = normalizeDomain(raw);

    if (!domain) {
        return 'Enter a valid domain, such as example.com.';
    }

    if (!DOMAIN_RE.test(domain)) {
        return 'That is not a valid domain.';
    }

    if (domain === 'localhost' || domain.includes(':')) {
        return 'This domain cannot be added.';
    }

    if (host && covers([domain], host)) {
        return "You can't block the website you are currently visiting.";
    }

    const settings = await getSettings();

    if (covers(settings.customBlocked, domain)) {
        return 'This domain is already blocked.';
    }

    if (settings.customBlocked.length >= 100) {
        return 'Maximum of 100 custom domains reached.';
    }

    await save({
        customBlocked: [
            ...settings.customBlocked,
            domain
        ]
    });

    return '';
}

/* =========================================
   RENDER BLOCKED ATTEMPTS
   ========================================= */

function renderAttempts(events, custom) {
    const rows = events.filter(event => event.host);

    const wrap = $('#attempts-wrap');

    wrap.hidden = rows.length === 0;

    const ul = $('#attempts');

    ul.replaceChildren();

    for (const event of rows) {
        const li = document.createElement('li');

        const kind = document.createElement('span');

        kind.className = 'kind';

        kind.textContent =
            KIND[event.kind] || event.kind;

        const domain = document.createElement('span');

        domain.className = 'dom';

        domain.textContent = event.host;

        const button = document.createElement('button');

        button.type = 'button';

        const done = covers(custom, event.host);

        button.textContent = done ? 'Blocked' : 'Block';

        button.disabled = done;

        button.addEventListener('click', async () => {
            button.disabled = true;

            try {
                const error = await addBlockedDomain(event.host);

                if (error) {
                    button.disabled = false;
                    showMessage(error);
                    return;
                }

                button.textContent = 'Blocked';

                await renderCustom();

            } catch (error) {
                button.disabled = false;
                showMessage('Unable to save this domain.');
                console.error(error);
            }
        });

        li.append(kind, domain, button);

        ul.append(li);
    }
}

/* =========================================
   RENDER CUSTOM DOMAINS
   ========================================= */

async function renderCustom() {
    const settings = await getSettings();

    const ul = $('#custom-list');

    ul.replaceChildren();

    for (const domain of settings.customBlocked) {
        const li = document.createElement('li');

        const name = document.createElement('span');

        name.className = 'dom';

        name.textContent = domain;

        const remove = document.createElement('button');

        remove.type = 'button';

        remove.className = 'remove';

        remove.textContent = 'Remove';

        remove.setAttribute(
            'aria-label',
            `Remove ${domain}`
        );

        remove.addEventListener('click', async () => {
            remove.disabled = true;

            try {
                const current = await getSettings();

                await save({
                    customBlocked: current.customBlocked
                        .filter(item => item !== domain)
                });

                await renderCustom();

            } catch (error) {
                remove.disabled = false;
                console.error(error);
            }
        });

        li.append(name, remove);

        ul.append(li);
    }
}

/* =========================================
   MESSAGE DISPLAY
   ========================================= */

function showMessage(message) {
    const element = $('#msg');

    element.textContent = message;

    element.hidden = !message;
}

/* =========================================
   TAB RELOAD
   ========================================= */

async function reloadTab() {
    if (!tab?.id || !host) return;

    try {
        await chrome.tabs.reload(tab.id);
    } catch (error) {
        console.error('[AdShield] Reload failed:', error);
    }
}

/* =========================================
   MASTER SETTINGS
   ========================================= */

async function init() {
    if (initialized) return;

    initialized = true;

    try {
        [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        host = tab ? siteHost(tab.url) : '';

        const settings = await getSettings();

        $('#host').textContent = host || 'No website open';

        $('#version').textContent =
            `Version ${chrome.runtime.getManifest().version}`;

        $('#master').checked = settings.enabled;

        $('#notif').checked = settings.blockNotifications;

        $('#yt').checked = settings.youtubeSkip;

        $('#strict').checked = settings.strictRedirects;

        // Checked means protection is active on this site.
        $('#site').checked =
            !!host && !covers(settings.allowlist, host);

        if (!host) {
            $('#site').disabled = true;

            $('#note').hidden = false;

            $('#total').textContent = '—';

            $('#bar').hidden = true;

        } else {
            const data = await pageData(tab.id);

            renderCounts(data);

            renderAttempts(
                data.events,
                settings.customBlocked
            );
        }

        await renderCustom();

        /* =====================================
           MASTER SWITCH
           ===================================== */

        $('#master').addEventListener('change', async event => {
            try {
                await save({
                    enabled: event.target.checked
                });

                await reloadTab();

            } catch (error) {
                console.error(error);
            }
        });

        /* =====================================
           NOTIFICATIONS
           ===================================== */

        $('#notif').addEventListener('change', async event => {
            try {
                await save({
                    blockNotifications: event.target.checked
                });
            } catch (error) {
                console.error(error);
            }
        });

        /* =====================================
           YOUTUBE
           ===================================== */

        $('#yt').addEventListener('change', async event => {
            try {
                await save({
                    youtubeSkip: event.target.checked
                });

                await reloadTab();

            } catch (error) {
                console.error(error);
            }
        });

        /* =====================================
           STRICT REDIRECT
           ===================================== */

        $('#strict').addEventListener('change', async event => {
            try {
                await save({
                    strictRedirects: event.target.checked
                });

                await reloadTab();

            } catch (error) {
                console.error(error);
            }
        });

        /* =====================================
           SITE PROTECTION
           ===================================== */

        $('#site').addEventListener('change', async event => {
            if (!host) return;

            try {
                const current = await getSettings();

                const remaining = current.allowlist.filter(
                    domain => !covers([domain], host)
                );

                const allowlist = event.target.checked
                    ? remaining
                    : [...remaining, host];

                await save({
                    allowlist: [...new Set(allowlist)]
                });

                await reloadTab();

            } catch (error) {
                console.error(error);
            }
        });

        /* =====================================
           ADD CUSTOM DOMAIN
           ===================================== */

        const submit = async () => {
            const input = $('#domain');

            const button = $('#add');

            button.disabled = true;

            try {
                const error = await addBlockedDomain(input.value);

                showMessage(error);

                if (!error) {
                    input.value = '';

                    await renderCustom();
                }

            } catch (error) {
                showMessage('Unable to add this domain.');

                console.error(error);

            } finally {
                button.disabled = false;
            }
        };

        $('#add').addEventListener('click', submit);

        $('#domain').addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                submit();
            }
        });

    } catch (error) {
        console.error('[AdShield] Popup initialization failed:', error);

        $('#note').hidden = false;

        $('#note').textContent =
            'Unable to load AdShield. Please reload the extension.';
    }
}

/* =========================================
   START
   ========================================= */

init();
