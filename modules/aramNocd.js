/**
 * @name Snooze-ARAMNoCD
 * @version 1.0.0
 * @author SnoozeFest - github@ReformedDoge
 * @description Removes ARAM bench cooldown visuals and enables instant bench swaps.
 * @link https://github.com/ReformedDoge
 */
import Utils from './generalUtils.js';


let isEnabled = false;
let benchContainerUnsub = null;
let aramPhaseUnsub = null;

function toggleFeature(enabled) {
    isEnabled = enabled;
    Utils.Store.set('aramNocd', 'enabled', enabled);
    if (enabled) mountAramNocd();
    else unmountAramNocd();
}

function extractChampionId(item) {
    if (!item) return null;
    const match = item.outerHTML.match(/champion-icons\/(\d+)\.png/);
    return match ? Number(match[1]) : null;
}

async function doBenchSwap(championId) {
    try {
        await Utils.LCU.post(`/lol-champ-select/v1/session/bench/swap/${championId}`);
    } catch (err) {}
}

/**
 * Targeted bench Utils.DOM.observer:
 * - Watches .bench-container for mutations 
 * - Removes cooldown classes and hides masks 
 * - Adds click hijack handlers on bench items 
 */
let benchObserver = null;
let benchProcessScheduled = false;

function startBenchObserver() {
    const container = document.querySelector('.bench-container');
    if (!container) return; // Container not in DOM yet — SmartObserver will call when it appears
    if (benchObserver) return; // Already actively watching

    const process = () => {
        benchProcessScheduled = false;
        if (!isEnabled || !document.body.contains(container)) {
            stopBenchObserver();
            return;
        }

        // Remove cooldown classes and hide masks
        container.querySelectorAll('[class*="on-cooldown"]').forEach((el) => {
            const toRemove = Array.from(el.classList).filter((cls) => cls.startsWith('on-cooldown'));
            toRemove.forEach((cls) => el.classList.remove(cls));
            const mask = el.querySelector('.cooldown-mask');
            if (mask instanceof HTMLElement) mask.style.display = 'none';
        });

        // Add click hijack once per item
        const BENCH_HIJACK_ATTR = 'data-aram-nocd-hijacked';
        container.querySelectorAll(`.champion-bench-item:not([${BENCH_HIJACK_ATTR}])`).forEach((item) => {
            if (item.classList.contains('empty-bench-item') || item.classList.contains('locked-out')) return;
            item.setAttribute(BENCH_HIJACK_ATTR, 'true');
            item.addEventListener('click', (e) => {
                if (!isEnabled) return;
                const championId = extractChampionId(item);
                if (!championId) return;
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                doBenchSwap(championId);
            }, true);
        });
    };

    const scheduleProcess = () => {
        if (benchProcessScheduled) return;
        benchProcessScheduled = true;
        requestAnimationFrame(process);
    };

    // Observer that watches .bench-container
    benchObserver = new MutationObserver(scheduleProcess);
    benchObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    // Run immediately for existing elements
    process();
}

function stopBenchObserver() {
    if (benchObserver) {
        benchObserver.disconnect();
        benchObserver = null;
    }
    benchProcessScheduled = false;
}

export function init(context) {
    Utils.Settings.inject(context, {
        name: "aram-nocd-settings",
        titleKey: "snooze_aram-nocd",
        titleName: "ARAM No Cooldown",
        capitalTitleKey: "snooze_aram-nocd_capital",
        capitalTitleName: "ARAM NO COOLDOWN",
        class: "aram-nocd-settings"
    });

    isEnabled = Utils.Store.get('aramNocd', 'enabled') || false;

    if (window.SnoozeManager && window.SnoozeManager.registerModule) {
        window.SnoozeManager.registerModule({
            id: 'aramNocd',
            name: 'ARAM No Cooldown',
            description: 'Removes the cooldown when swapping champions with the ARAM bench.',
            settings: [
                {
                    type: 'toggle',
                    id: 'sm:aramNocd',
                    label: 'Enable ARAM No Cooldown',
                    value: isEnabled,
                    onChange: (val) => toggleFeature(val)
                }
            ]
        });
    } else {
        // Native settings UI injection
        Utils.DOM.observer.observe("lol-uikit-scrollable.aram-nocd-settings", (plugin) => {
            plugin.appendChild(Utils.Settings.createToggleRow("Enable ARAM No Cooldown", isEnabled, (next) => {
                isEnabled = next;
                toggleFeature(isEnabled);
            }));
        });
    }
}

function handleAramPhase(phase) {
    if (isEnabled && phase === 'ChampSelect') {
        startBenchObserver();
    } else {
        stopBenchObserver();
    }
}

function mountAramNocd() {
    if (!benchContainerUnsub) {
    // SmartObserver detects when the bench container appears, then starts a scoped Utils.DOM.observer
    benchContainerUnsub = Utils.DOM.observer.observe('.bench-container', (container) => {
        if (!isEnabled) return;
        startBenchObserver();
    });
    }

    // Start/stop the scoped Utils.DOM.observer based on gameflow phase
    if (Utils.LCU && Utils.LCU.observe && !aramPhaseUnsub) {
        aramPhaseUnsub = Utils.LCU.observe('/lol-gameflow/v1/gameflow-phase', e => handleAramPhase(e.data));

        Utils.LCU.get('/lol-gameflow/v1/gameflow-phase').then(phase => {
            handleAramPhase(phase);
        }).catch(() => {});
    }
}

function unmountAramNocd() {
    if (benchContainerUnsub) {
        benchContainerUnsub();
        benchContainerUnsub = null;
    }
    if (aramPhaseUnsub) {
        aramPhaseUnsub();
        aramPhaseUnsub = null;
    }
    stopBenchObserver();
}

export function load() {
    if (isEnabled) mountAramNocd();
}
