(() => {
    'use strict';

    if (window.__adshieldInstalled) return;

    Object.defineProperty(window, '__adshieldInstalled', {
        value: true
    });

    let enabled = true;
    let strict = true;
    let blockNotifications = true;

    /* ================= HELPERS ================= */

    const SLD = new Set([
        'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
        'com.bd', 'net.bd', 'org.bd', 'edu.bd', 'gov.bd',
        'co.in', 'com.au', 'co.jp', 'co.nz',
        'com.br', 'com.pk', 'co.za'
    ]);

    function regDomain(host) {
        const p = String(host).toLowerCase().split('.');

        if (p.length <= 2) return p.join('.');

        const suffix = p.slice(-2).join('.');

        return SLD.has(suffix)
            ? p.slice(-3).join('.')
            : suffix;
    }

    // Trusted destinations
    const TRUSTED = new Set([
        'google.com',
        'googleapis.com',
        'gstatic.com',
        'apple.com',
        'microsoft.com',
        'live.com',
        'microsoftonline.com',
        'facebook.com',
        'fb.com',
        'instagram.com',
        'twitter.com',
        'x.com',
        'linkedin.com',
        'github.com',
        'gitlab.com',
        'paypal.com',
        'stripe.com',
        'auth0.com',
        'okta.com',
        'whatsapp.com',
        'wa.me',
        't.me',
        'telegram.me',
        'pinterest.com',
        'reddit.com',
        'youtube.com',
        'youtu.be',
        'bkash.com',
        'sslcommerz.com',
        'nagad.com.bd'
    ]);

    function isTrusted(host) {
        host = String(host).toLowerCase();

        for (const domain of TRUSTED) {
            if (host === domain || host.endsWith('.' + domain)) {
                return true;
            }
        }

        return false;
    }

    const INTERACTIVE = [
        'a[href]',
        'button',
        'input',
        'select',
        'textarea',
        'summary',
        'label',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]'
    ].join(',');

    function report(kind, url) {

        let host = '';

        try {
            host = new URL(url || '', location.href).hostname;
        } catch (_) {}

        window.postMessage({
            source: 'adshield-main',
            type: 'blocked',
            kind,
            host
        }, '*');
    }

    /* ================= CONFIGURATION ================= */

    window.addEventListener('message', (e) => {

        const d = e.data;

        if (
            e.source !== window ||
            !d ||
            d.source !== 'adshield-content' ||
            d.type !== 'config'
        ) return;

        enabled = !!d.enabled;
        strict = d.strict !== false;
        blockNotifications = d.notifications !== false;

    });

    window.postMessage({
        source: 'adshield-main',
        type: 'ready'
    }, '*');

    /* ================= USER CLICK TRACKING ================= */

    const COVER = 0.6;

    let last = {
        time: -1e9,
        suspicious: false,
        used: 0
    };

    function findOverlay(el) {

        for (
            let n = el;
            n instanceof Element && n !== document.documentElement;
            n = n.parentElement
        ) {

            const cs = getComputedStyle(n);

            if (
                cs.position !== 'fixed' &&
                cs.position !== 'absolute'
            ) continue;

            if (
                n.parentElement !== document.body &&
                n.parentElement !== document.documentElement
            ) continue;

            const r = n.getBoundingClientRect();

            if (
                r.width < innerWidth * COVER ||
                r.height < innerHeight * COVER
            ) continue;

            const invisible = parseFloat(cs.opacity) < 0.05;

            const noBackground =
                cs.backgroundColor === 'rgba(0, 0, 0, 0)' ||
                cs.backgroundColor === 'transparent';

            const empty =
                !n.textContent.trim() &&
                !n.querySelector('img,video,canvas,svg,input,button');

            if (invisible || (noBackground && empty)) {
                return n;
            }
        }

        return null;
    }

    function noteClick(e, block) {

        if (!enabled || !e.isTrusted) return;

        const t = e.target;

        const isEl = t instanceof Element;

        const overlay = isEl ? findOverlay(t) : null;

        const notAControl =
            strict && !(isEl && t.closest(INTERACTIVE));

        const suspicious =
            t === document.body ||
            t === document.documentElement ||
            !!overlay ||
            notAControl;

        last = {
            time: performance.now(),
            suspicious,
            used: 0
        };

        if (block && overlay) {

            e.stopImmediatePropagation();
            e.preventDefault();

            overlay.style.setProperty(
                'display',
                'none',
                'important'
            );

            report('overlay', '');
        }
    }

    document.addEventListener(
        'mousedown',
        e => noteClick(e, false),
        true
    );

    document.addEventListener(
        'click',
        e => noteClick(e, true),
        true
    );

    function fromRealClick() {

        const active = navigator.userActivation
            ? navigator.userActivation.isActive
            : false;

        return (
            active &&
            performance.now() - last.time < 1500 &&
            !last.suspicious
        );
    }

    /* ================= POPUP BLOCKER ================= */

    const nativeOpen = window.open;

    function fakeWindow() {

        return {
            closed: true,
            close() {},
            focus() {},
            blur() {},
            postMessage() {},
            location: {
                href: '',
                assign() {},
                replace() {}
            },
            document: {
                write() {},
                writeln() {},
                close() {}
            }
        };
    }

    function popupAllowed(url) {

        if (!fromRealClick() || last.used >= 1) {
            return false;
        }

        if (!strict) return true;

        let u;

        try {
            u = new URL(url || '', location.href);
        } catch (_) {
            return false;
        }

        if (!/^https?:$/.test(u.protocol)) {
            return false;
        }

        return (
            regDomain(u.hostname) === regDomain(location.hostname) ||
            isTrusted(u.hostname)
        );
    }

    Object.defineProperty(window, 'open', {

        configurable: true,
        writable: true,

        value: function (url, target) {

            if (
                !enabled ||
                /^_(self|parent|top)$/i.test(target || '')
            ) {
                return nativeOpen.apply(this, arguments);
            }

            if (popupAllowed(url)) {

                last.used++;

                return nativeOpen.apply(this, arguments);
            }

            report('popup', url);

            return fakeWindow();
        }
    });

    /* ================= SCRIPT CLICK BLOCKER ================= */

    function scriptClickBlocked(a) {

        if (
            !enabled ||
            a.hasAttribute('download') ||
            /^(blob|data|javascript):/i.test(a.href)
        ) return false;

        let host;

        try {
            host = new URL(a.href, location.href).hostname;
        } catch (_) {
            return false;
        }

        const cross =
            regDomain(host) !== regDomain(location.hostname);

        const newTab =
            (a.target || '').toLowerCase() === '_blank';

        if (!cross && !newTab) return false;

        if (!fromRealClick()) return true;

        return strict && cross && !isTrusted(host);
    }

    const nativeAnchorClick =
        HTMLAnchorElement.prototype.click;

    HTMLAnchorElement.prototype.click = function () {

        if (scriptClickBlocked(this)) {

            report('hijack', this.href);

            return;
        }

        return nativeAnchorClick.apply(this, arguments);
    };

    const nativeDispatch =
        EventTarget.prototype.dispatchEvent;

    EventTarget.prototype.dispatchEvent = function (ev) {

        if (
            ev &&
            ev.type === 'click' &&
            !ev.isTrusted &&
            this instanceof HTMLAnchorElement &&
            scriptClickBlocked(this)
        ) {

            report('hijack', this.href);

            return false;
        }

        return nativeDispatch.apply(this, arguments);
    };

    /* ================= REDIRECT BLOCKER ================= */

    if ('navigation' in window) {

        navigation.addEventListener('navigate', (e) => {

            if (
                !enabled ||
                !e.cancelable ||
                e.userInitiated ||
                e.hashChange ||
                e.downloadRequest != null
            ) return;

            if (
                e.navigationType !== 'push' &&
                e.navigationType !== 'replace'
            ) return;

            let dest;

            try {
                dest = new URL(e.destination.url);
            } catch (_) {
                return;
            }

            if (!/^https?:$/.test(dest.protocol)) return;

            if (
                regDomain(dest.hostname) ===
                regDomain(location.hostname)
            ) return;

            if (isTrusted(dest.hostname)) return;

            if (
                !strict &&
                (
                    fromRealClick() ||
                    navigator.userActivation?.isActive
                )
            ) return;

            e.preventDefault();

            report('redirect', dest.href);

        });
    }

    /* ================= NOTIFICATION BLOCKER ================= */

    if (
        window.Notification &&
        typeof Notification.requestPermission === 'function'
    ) {

        const nativeRequest =
            Notification.requestPermission;

        Notification.requestPermission = function (callback) {

            if (!(enabled && blockNotifications)) {
                return nativeRequest.apply(this, arguments);
            }

            if (typeof callback === 'function') {

                try {
                    callback('denied');
                } catch (_) {}
            }

            report('notification', '');

            return Promise.resolve('denied');
        };
    }

    console.log('[AdShield] Main-world protection initialized.');

})();