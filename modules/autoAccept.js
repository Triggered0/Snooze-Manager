/**
 * @name Snooze-AutoAccept
 * @version 1.0.0
 * @author SnoozeFest - github@ReformedDoge
 * @description Automatically accept ready checks with optional delay and decline handling.
 * @link https://github.com/ReformedDoge
 */
import Utils, { t } from './generalUtils.js';

const SETTINGS_KEY = 'enabled';
const DELAY_KEY = 'delay';
const EXIT_ON_DECLINE_KEY = 'exitOnDecline';
const EXIT_ON_DODGE_KEY = 'exitOnDodge';
const HIDE_READY_CHECK_KEY = 'hideReadyCheck';
const DELAY_MIN = 0;
const DELAY_MAX = 10;

let isEnabled = false;
let acceptedCurrentReadyCheck = false;
let wasInReadyCheck = false;
let pendingAcceptTimer = null;
let pendingPanicUnsub = null;

function cancelPendingAccept() {
    if (pendingAcceptTimer !== null) clearTimeout(pendingAcceptTimer);
    pendingAcceptTimer = null;
    pendingPanicUnsub?.();
    pendingPanicUnsub = null;
}

function toggleAutoAccept(enabled) {
    isEnabled = enabled;
    Utils.Store.set('autoAccept', SETTINGS_KEY, enabled);
}

function migrateSettings() {
    const currentExitOnDecline = Utils.Store.get('autoAccept', EXIT_ON_DECLINE_KEY);
    const oldExitOnDecline = Utils.Store.get('autoAccept', 'sm:autoAcceptExitOnDecline');

    if (currentExitOnDecline === undefined && oldExitOnDecline !== undefined) {
        Utils.Store.set('autoAccept', EXIT_ON_DECLINE_KEY, oldExitOnDecline);
        Utils.Store.remove('autoAccept', 'sm:autoAcceptExitOnDecline');
    }
}

function exitQueueOnDodge(source) {
    Utils.Debug.log(`[AutoAccept] Dodge detected via ${source}. Exiting queue...`);
    Utils.LCU.delete('/lol-lobby/v2/lobby/matchmaking/search').catch(() => {});
}

function getDelay() {
    const v = Utils.Store.get('autoAccept', DELAY_KEY);
    if (v === undefined || v === null) return 0;
    const n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.min(DELAY_MAX, Math.max(DELAY_MIN, n));
}

function renderExtraSettings(container, native = false) {
    container.style.flexDirection = 'column';
    container.style.alignItems = 'stretch';
    container.style.gap = '10px';
    container.style.paddingLeft = '20px';
    container.style.marginTop = '0';
    container.style.borderLeft = '2px solid #3e2e13';

    container.appendChild(Utils.Settings.createNumberInputRow(t('Accept Delay (seconds)'), getDelay(), DELAY_MIN, DELAY_MAX, 0.5, (v) => {
        Utils.Store.set('autoAccept', DELAY_KEY, v);
    }));

    // Exit on Decline Toggle
    const exitEnabled = Utils.Store.get('autoAccept', EXIT_ON_DECLINE_KEY) || false;
    container.appendChild(Utils.Settings.createToggleRow(t('Exit queue if someone declines'), exitEnabled, (next) => {
        Utils.Store.set('autoAccept', EXIT_ON_DECLINE_KEY, next);
    }));

    // Exit on Dodge Toggle
    const exitDodgeEnabled = Utils.Store.get('autoAccept', EXIT_ON_DODGE_KEY) || false;
    container.appendChild(Utils.Settings.createToggleRow(t('Exit queue if someone dodges'), exitDodgeEnabled, (next) => {
        Utils.Store.set('autoAccept', EXIT_ON_DODGE_KEY, next);
    }));

    // Hide Ready Check Modal
    const hideReadyCheckEnabled = Utils.Store.get('autoAccept', HIDE_READY_CHECK_KEY) || false;
    container.appendChild(Utils.Settings.createToggleRow(t('Hide queue pop'), hideReadyCheckEnabled, (next) => {
        Utils.Store.set('autoAccept', HIDE_READY_CHECK_KEY, next);
    }));

    // Panic Key Hotkey
    const currentPanicKey = Utils.Store.get('global', 'panicKey') || 'F2';
    container.appendChild(Utils.Settings.createHotkeyRow(
        t('Panic Key (Cancel Auto Actions)'),
        currentPanicKey,
        (newKey) => Utils.Store.set('global', 'panicKey', newKey),
        t('Note: The Panic Key only works if you have set an Accept Delay greater than 0 seconds. You must press the key during the countdown window to cancel the action.')
    ));
}

export function init(context) {
    migrateSettings();

    Utils.Settings.inject(context, {
        name: "auto-accept-settings",
        titleKey: "snooze_auto-accept",
        titleName: t("Auto Accept"),
        capitalTitleKey: "snooze_auto-accept_capital",
        capitalTitleName: t("AUTO ACCEPT"),
        class: "auto-accept-settings"
    });

    isEnabled = Utils.Store.get('autoAccept', SETTINGS_KEY) || false;

    if (Utils.Store.get('autoAccept', DELAY_KEY) === undefined) {
        Utils.Store.set('autoAccept', DELAY_KEY, 0);
    }

    installReadyCheckAudioHook();
    installExitOnDodgeEmberHook();
    installHideReadyCheckEmberHook();

    if (window.SnoozeManager && window.SnoozeManager.registerModule) {
        window.SnoozeManager.registerModule({
            id: 'autoAccept',
            name: t('Auto Accept'),
            description: t('Automatically accepts matchmaking ready checks with optional delay and queue exit on decline.'),
            settings: [{
                    type: 'toggle',
                    id: SETTINGS_KEY,
                    label: t('Enable Auto Accept'),
                    value: isEnabled,
                    onChange: (val) => toggleAutoAccept(val)
                },
                {
                    type: 'custom',
                    render: (row) => renderExtraSettings(row)
                }
            ]
        });
    } else {
        Utils.DOM.observer.observe("lol-uikit-scrollable.auto-accept-settings", (plugin) => {
            const row = document.createElement("div");
            row.classList.add("plugins-settings-row");
            row.appendChild(
                Utils.Settings.createToggleRow(t("Enable Auto Accept"), isEnabled, (val) => {
                    isEnabled = val;
                    toggleAutoAccept(isEnabled);
                })
            );
            const extraRow = document.createElement("div");
            extraRow.classList.add("plugins-settings-row");
            extraRow.style.marginTop = "10px";
            renderExtraSettings(extraRow, true);
            plugin.appendChild(row);
            plugin.appendChild(extraRow);
        });
    }
}

export function calculateEffectiveAcceptDelayMs(configuredDelaySeconds) {
    const raw = Number(configuredDelaySeconds);
    const validDelay = (!isFinite(raw) || raw < 0) ? 0 : raw;
    return Math.round(validDelay * 1000);
}

let _phaseUnsub = null;
let _readyCheckUnsub = null;
let _notificationsUnsub = null;
let _readyCheckAudioHookCleanup = null;
let _hideReadyCheckHookCleanup = null;
let _exitOnDodgeHookCleanup = null;
let _watchdogTimer = null;
let _activeReadyCheckComponent = null;
let _currentPhase = null;

export function stopReadyCheckAudio(force = false) {
    if (!force && _currentPhase === 'ReadyCheck') return;
    if (!_activeReadyCheckComponent) return;
    try {
        _activeReadyCheckComponent.fadeOutIdleSounds?.();
        const loopSound = _activeReadyCheckComponent.get?.('timerAcceptLoopSound');
        if (loopSound?.stop) loopSound.stop();
        const matchSound = _activeReadyCheckComponent.get?.('matchFoundSound');
        if (matchSound?.stop) matchSound.stop();
        const countdownSound = _activeReadyCheckComponent.get?.('timerCountdownSound');
        if (countdownSound?.stop) countdownSound.stop();
    } catch (_) {}
}

function installReadyCheckAudioHook() {
    if (!Utils.Hooks?.Ember?.registerRule) return;
    _readyCheckAudioHookCleanup = Utils.Hooks.Ember.registerRule({
        name: 'autoAccept-readyCheckAudio',
        matcher: 'ready-check-root-element',
        hookMethods: [
            {
                name: 'didInsertElement',
                callback(Ember, original, ...args) {
                    original(...args);
                    _activeReadyCheckComponent = this;
                }
            },
            {
                name: 'willDestroyElement',
                callback(Ember, original, ...args) {
                    try {
                        this.fadeOutIdleSounds?.();
                        this.get?.('timerAcceptLoopSound')?.stop?.();
                        this.get?.('matchFoundSound')?.stop?.();
                        this.get?.('timerCountdownSound')?.stop?.();
                    } catch (_) {}
                    if (_activeReadyCheckComponent === this) {
                        _activeReadyCheckComponent = null;
                    }
                    original(...args);
                }
            }
        ]
    });
}

function startWatchdog() {
    if (_watchdogTimer) return;
    _watchdogTimer = setInterval(async () => {
        try {
            const data = await Utils.LCU.get('/lol-matchmaking/v1/ready-check');
            if (data && data.state === 'InProgress' && data.playerResponse === 'None') {
                triggerAccept('Watchdog');
            }
        } catch (_) {}
    }, 1000);
}

function stopWatchdog() {
    if (_watchdogTimer) {
        clearInterval(_watchdogTimer);
        _watchdogTimer = null;
    }
}

function triggerAccept(source = 'WS') {
    if (!isEnabled) return;
    if (acceptedCurrentReadyCheck) return;
    acceptedCurrentReadyCheck = true;
    wasInReadyCheck = true;

    const delay = getDelay();
    const safeDelayMs = calculateEffectiveAcceptDelayMs(delay);

    cancelPendingAccept();
    let isCancelled = false;
    pendingPanicUnsub = Utils.Panic.register(() => {
        isCancelled = true;
        cancelPendingAccept();
    });

    if (safeDelayMs === 0) {
        pendingAcceptTimer = null;
        pendingPanicUnsub?.();
        pendingPanicUnsub = null;
        Utils.Debug.log(`[AutoAccept] Accepting ready check instantly (0ms delay, source: ${source})...`);
        Utils.LCU.post('/lol-matchmaking/v1/ready-check/accept').catch(() => {});
        return;
    }

    Utils.Debug.log(`[AutoAccept] Accepting ready check in ${safeDelayMs}ms (source: ${source})...`);

    pendingAcceptTimer = setTimeout(() => {
        pendingAcceptTimer = null;
        pendingPanicUnsub?.();
        pendingPanicUnsub = null;
        if (isCancelled || !isEnabled || !acceptedCurrentReadyCheck) return;
        Utils.LCU.post('/lol-matchmaking/v1/ready-check/accept').catch(() => {});
    }, safeDelayMs);
}

export function load() {
    if (Utils.LCU && Utils.LCU.observe) {
        _phaseUnsub = Utils.LCU.observe('/lol-gameflow/v1/gameflow-phase', e => {
            const phase = e.data;
            _currentPhase = phase;
            const exitOnDecline = Utils.Store.get('autoAccept', EXIT_ON_DECLINE_KEY);

            if (phase === 'Matchmaking') {
                startWatchdog();
                cancelPendingAccept();
                wasInReadyCheck = false;
                acceptedCurrentReadyCheck = false;
                stopReadyCheckAudio(true);
            } else if (phase === 'ReadyCheck') {
                triggerAccept('GameflowPhase');
            } else if (phase === 'ChampSelect' || phase === 'InProgress') {
                stopWatchdog();
                cancelPendingAccept();
                wasInReadyCheck = false;
                acceptedCurrentReadyCheck = false;
                stopReadyCheckAudio(true);
                setTimeout(() => stopReadyCheckAudio(true), 300);
                setTimeout(() => stopReadyCheckAudio(true), 1000);
            } else if (phase === 'Lobby') {
                stopWatchdog();
                cancelPendingAccept();
                const wasReady = wasInReadyCheck;
                wasInReadyCheck = false;
                acceptedCurrentReadyCheck = false;
                stopReadyCheckAudio(true);
                if (wasReady && exitOnDecline) {
                    Utils.Debug.log('[AutoAccept] ReadyCheck ended without accepting (decline/timeout). Exiting queue...');
                    Utils.LCU.delete('/lol-lobby/v2/lobby/matchmaking/search').catch(() => {});
                }
            } else {
                stopWatchdog();
                cancelPendingAccept();
                wasInReadyCheck = false;
                acceptedCurrentReadyCheck = false;
                stopReadyCheckAudio(true);
            }
        });

        _readyCheckUnsub = Utils.LCU.observe('/lol-matchmaking/v1/ready-check', e => {
            if (!e.data) return;
            const data = e.data;

            if (data.state === 'InProgress') {
                if (data.playerResponse === 'None') {
                    triggerAccept('ReadyCheckEvent');
                } else if (data.playerResponse === 'Accepted') {
                    acceptedCurrentReadyCheck = true;
                    cancelPendingAccept();
                }
            } else if (data.state === 'StrangerNotReady' || data.state === 'PartyNotReady') {
                cancelPendingAccept();
                acceptedCurrentReadyCheck = false;
                wasInReadyCheck = false;
                if (Utils.Store.get('autoAccept', EXIT_ON_DECLINE_KEY)) {
                    Utils.Debug.log('[AutoAccept] Queue declined by someone. Exiting queue...');
                    Utils.LCU.delete('/lol-lobby/v2/lobby/matchmaking/search').catch(() => {});
                }
            } else if (data.state === 'EveryoneReady') {
                cancelPendingAccept();
            }
        });

        _notificationsUnsub = Utils.LCU.observe('/lol-lobby/v2/notifications', e => {
            if (!e.data || !Utils.Store.get('autoAccept', EXIT_ON_DODGE_KEY)) return;
            const notifications = Array.isArray(e.data) ? e.data : [e.data];
            for (const n of notifications) {
                if (n.notificationReason === 'StrangerDodged') {
                    exitQueueOnDodge('WS:/lol-lobby/v2/notifications');
                    break;
                }
            }
        });

    }
}

function installHideReadyCheckEmberHook() {
    if (!Utils.Hooks?.Ember?.registerRule) return;
    _hideReadyCheckHookCleanup = Utils.Hooks.Ember.registerRule({
        name: 'autoAccept-hideReadyCheck',
        matcher: 'ready-check-root-element',
        hookMethods: [{
            name: 'didInsertElement',
            callback(Ember, original, ...args) {
                original(...args);
                const enabled = Utils.Store.get('autoAccept', SETTINGS_KEY) && Utils.Store.get('autoAccept', HIDE_READY_CHECK_KEY);
                if (!enabled) return;
                const e = this.element?.parentElement?.parentElement;
                if (e) {
                    e.style.opacity = '0';
                    e.style.pointerEvents = 'none';
                }
            }
        }]
    });
}

function installExitOnDodgeEmberHook() {
    if (!Utils.Hooks?.Ember?.registerRule) return;
    _exitOnDodgeHookCleanup = Utils.Hooks.Ember.registerRule({
        name: 'autoAccept-exitOnDodge',
        matcher: 'parties-notifications',
        hookMethods: [{
            name: '_strangerDodged',
            callback(Ember, original, ...args) {
                original(...args);
                if (!Utils.Store.get('autoAccept', EXIT_ON_DODGE_KEY)) return;
                exitQueueOnDodge('EmberHook:parties-notifications._strangerDodged');
            }
        }]
    });
}
export function unload() {
    stopWatchdog();
    cancelPendingAccept();
    stopReadyCheckAudio(true);
    _currentPhase = null;
    acceptedCurrentReadyCheck = false;
    wasInReadyCheck = false;
    _phaseUnsub?.();
    _phaseUnsub = null;
    _readyCheckUnsub?.();
    _readyCheckUnsub = null;
    _notificationsUnsub?.();
    _notificationsUnsub = null;
    _readyCheckAudioHookCleanup?.();
    _readyCheckAudioHookCleanup = null;
    _activeReadyCheckComponent = null;
    _hideReadyCheckHookCleanup?.();
    _hideReadyCheckHookCleanup = null;
    _exitOnDodgeHookCleanup?.();
    _exitOnDodgeHookCleanup = null;
}
