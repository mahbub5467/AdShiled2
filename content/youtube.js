(() => {
    'use strict';

    const ext = globalThis.browser ?? globalThis.chrome;

    if (!ext || !ext.runtime) {
        console.error('[AdShield] Extension API unavailable.');
        return;
    }

    // YouTube advertisement selectors
    const HIDE = [
        '#masthead-ad',
        '#player-ads',
        'ytd-ad-slot-renderer',
        'ytd-in-feed-ad-layout-renderer',
        'ytd-banner-promo-renderer',
        'ytd-promoted-sparkles-web-renderer',
        'ytd-promoted-video-renderer',
        'ytd-display-ad-renderer',
        'ytd-companion-slot-renderer',
        'ytd-action-companion-ad-renderer',
        '.ytp-ad-overlay-container',
        '.ytp-ad-image-overlay',
        '.ytp-ad-message-container',
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
        'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)'
    ].join(',');

    // YouTube skip buttons
    const SKIP_BUTTONS = [
        '.ytp-skip-ad-button',
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-ad-skip-button-container button',
        'button.ytp-skip-ad-button'
    ].join(',');

    function sendMessage(message) {
        try {
            const result = ext.runtime.sendMessage(message);
            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }
        } catch (error) {
            // Ignore communication errors
        }
    }

    function injectStyle() {
        if (document.getElementById('adshield-youtube-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'adshield-youtube-style';
        style.textContent = `
            ${HIDE} {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    // Fallback for an ad that still appears: press its Skip button.
    // The player itself (time, speed, mute) is not touched.
    function watchAds() {
        setInterval(() => {
            const skip = document.querySelector(SKIP_BUTTONS);
            if (skip && !skip.disabled) skip.click();
        }, 500);
    }

    async function initialize() {
        try {
            if (!globalThis.__adshield?.settings) {
                console.error('[AdShield] Settings unavailable.');
                return;
            }

            const settings = await globalThis.__adshield.settings;
            if (!settings || !settings.active || !settings.youtubeSkip) {
                return;
            }

            injectStyle();
            watchAds();
            console.log('[AdShield] YouTube protection initialized.');
        } catch (error) {
            console.error('[AdShield] Initialization failed:', error);
        }
    }

    initialize();
})();