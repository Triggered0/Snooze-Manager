/**
 * @name Snooze-ChampSelectQuitButton
 * @version 1.0.0
 * @author SnoozeFest - github@ReformedDoge
 * @description Adds a dodge button in champion select for quick lobby exit.
 * @link https://github.com/ReformedDoge
 */
import Utils, { t } from './generalUtils.js';

let isEnabled = false;
let _hookCleanups = [];
let _domObserverCleanup = null;

function toggleFeature(enabled) {
    isEnabled = enabled;
    Utils.Store.set('champSelectQuitButton', 'enabled', enabled);
    if (!enabled) {
        document.querySelectorAll('#pm-quit-btn').forEach(btn => btn.remove());
    }
}

async function dodgeQueue() {
    Utils.Debug.log('[DodgeButton] Initiating champion select dodge...');

    // 1. Detect if this is a custom game or practice tool lobby
    let isCustom = false;
    try {
        const gf = await Utils.LCU.get('/lol-gameflow/v1/session').catch(() => null);
        if (gf?.gameData?.isCustomGame) {
            isCustom = true;
        } else {
            const cs = await Utils.LCU.get('/lol-champ-select/v1/session').catch(() => null);
            if (cs?.isCustomGame || cs?.isLegacyChampSelect) {
                isCustom = true;
            }
        }
    } catch (e) {}

    // Case A: Custom Game / Practice Tool -> Clean exit via LCU endpoint without restarting UX
    if (isCustom) {
        Utils.Debug.log('[DodgeButton] Custom game detected, using direct lobby cancel endpoints.');
        try {
            await Utils.LCU.post('/lol-lobby-team-builder/champ-select/v1/session/quit', {});
        } catch (e) {}
        try {
            await Utils.LCU.post('/lol-lobby/v1/lobby/custom/cancel-champ-select', {});
        } catch (e) {}

        const cancelSearch = async () => {
            try { await Utils.LCU.delete('/lol-lobby/v2/lobby/matchmaking/search'); } catch (e) {}
            try { await Utils.LCU.delete('/lol-matchmaking/v1/search'); } catch (e) {}
        };
        await cancelSearch();
        setTimeout(cancelSearch, 300);
        return true;
    }

    // Case B: Matchmade Queues (Ranked, Normal, ARAM, Arena, Swiftplay)
    // In matchmade queues, Riot servers strictly require a client disconnect to trigger dodge.
    // We execute an instant UX restart: it terminates LeagueClientUx (dropping the connection and triggering the server dodge),
    // and Riot Client immediately re-launches the client into the main menu in ~3 seconds.
    Utils.Debug.log('[DodgeButton] Matchmade queue detected, restarting UX to trigger server-side dodge.');
    try {
        await Utils.LCU.post('/riotclient/kill-and-restart-ux', {});
    } catch (err) {
        Utils.Debug.warn('[DodgeButton] LCU kill-and-restart-ux failed, trying direct fetch:', err);
        try {
            await fetch('/riotclient/kill-and-restart-ux', { method: 'POST' });
        } catch (fetchErr) {
            Utils.Debug.error('[DodgeButton] kill-and-restart-ux failed, trying process quit fallback:', fetchErr);
            try {
                await Utils.LCU.post('/process-control/v1/process/quit', {});
            } catch (quitErr) {}
        }
    }
    return true;
}

export function init(context) {
    Utils.Settings.inject(context, {
        name: "dodge-button-settings",
        titleKey: "snooze_dodge-button",
        titleName: t('Dodge Button'),
        capitalTitleKey: "snooze_dodge-button_capital",
        capitalTitleName: t('DODGE BUTTON'),
        class: "dodge-button-settings"
    });

    isEnabled = Utils.Store.get('champSelectQuitButton', 'enabled') || false;

    _hookCleanups.push(Utils.Hooks.Ember.registerRule({
        name: 'champ-select-quit-button-hook',
        matcher: 'champion-select',
        hookMethods: [{
            name: 'didInsertElement',
            callback(Ember, original, ...args) {
                original(...args);
                if (!Utils.Store.get('champSelectQuitButton', 'enabled')) return;
                if (!this.element) return;

                const container = this.element.querySelector('.bottom-right-buttons');
                if (!container) return;

                if (!container.querySelector('#pm-quit-btn')) {
                    const btn = document.createElement('lol-uikit-flat-button');
                    btn.id = 'pm-quit-btn';
                    btn.textContent = t('Dodge');
                    btn.style.cssText = 'margin-right: 10px; margin-top: 5px; width: auto; min-width: 80px; text-align: center;';

                    let dodging = false;
                    btn.onclick = async () => {
                        if (dodging) return;
                        dodging = true;
                        btn.disabled = true;
                        btn.textContent = t('Dodging...');
                        try {
                            await dodgeQueue();
                        } finally {
                            setTimeout(() => {
                                dodging = false;
                                btn.disabled = false;
                                btn.textContent = t('Dodge');
                            }, 1500);
                        }
                    };

                    if (container.firstChild) {
                        container.insertBefore(btn, container.firstChild);
                    } else {
                        container.appendChild(btn);
                    }
                }
            }
        }, {
            name: 'willDestroyElement',
            callback(Ember, original, ...args) {
                const btn = document.getElementById('pm-quit-btn');
                if (btn) btn.remove();
                original(...args);
            }
        }]
    }));

    if (window.SnoozeManager && window.SnoozeManager.registerModule) {
        window.SnoozeManager.registerModule({
            id: 'champSelectQuitButton',
            name: t('Champ Select Dodge Button'),
            description: t('Adds a dodge button in the champion select.'),
            settings: [{
                type: 'toggle',
                id: 'sm:champSelectQuitButton',
                label: t('Enable Champ Select Dodge Button'),
                value: isEnabled,
                onChange: (val) => toggleFeature(val)
            }]
        });
    } else {
        _domObserverCleanup = Utils.DOM.observer.observe("lol-uikit-scrollable.dodge-button-settings", (plugin) => {
            plugin.appendChild(Utils.Settings.createToggleRow("Enable Dodge Button", isEnabled, (next) => {
                isEnabled = next;
                toggleFeature(isEnabled);
            }));
        });
    }
}

export function load() {
    // Rely exclusively on Ember Hook rendering the component to manage DOM lifecycle.
}

export function unload() {
    for (const cleanup of _hookCleanups) cleanup?.();
    _hookCleanups = [];
    if (typeof _domObserverCleanup === 'function') _domObserverCleanup();
    _domObserverCleanup = null;
}