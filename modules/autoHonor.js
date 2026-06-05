/**
 * @name Snooze-AutoHonor
 * @version 1.0.0
 * @author SnoozeFest - github@ReformedDoge
 * @description Automatically honor players after matches using configurable target selection.
 * @link https://github.com/ReformedDoge
 */
import Utils from './generalUtils.js';

let isEnabled = false;
let honorAttemptedForCurrentGame = false;

function toggleFeature(enabled) {
    isEnabled = enabled;
    Utils.Store.set('autoHonor', 'enabled', enabled);
}

function renderExtraSettings(container) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'stretch';
    container.style.gap = '10px';
    container.style.paddingLeft = '20px';
    container.style.marginTop = '0';
    container.style.borderLeft = '2px solid #3e2e13';

    const selectRow = document.createElement('div');
    selectRow.style.display = 'flex';
    selectRow.style.width = '100%';
    
    const select = document.createElement('select');
    Object.assign(select.style, { background: '#111', color: '#f0e6d2', border: '1px solid #3e2e13', padding: '6px', borderRadius: '2px', flex: '1', outline: 'none' });
    
    const optAllies = document.createElement('option');
    optAllies.value = 'allies'; optAllies.textContent = 'Honor Allies';
    const optEnemies = document.createElement('option');
    optEnemies.value = 'enemies'; optEnemies.textContent = 'Honor Enemies';
    const optRandom = document.createElement('option');
    optRandom.value = 'random'; optRandom.textContent = 'Honor Random (Any)';

    select.appendChild(optAllies); 
    select.appendChild(optEnemies);
    select.appendChild(optRandom);
    
    select.value = Utils.Store.get('autoHonor', 'mode') || 'allies';
    select.addEventListener('change', (e) => Utils.Store.set('autoHonor', 'mode', e.target.value));
    selectRow.appendChild(select);

    container.appendChild(selectRow);
    container.appendChild(Utils.Settings.createToggleRow('Skip Honor', Utils.Store.get('autoHonor', 'skip') || false, (next) => {
        Utils.Store.set('autoHonor', 'skip', next);
    }));
}

export function init(context) {
    Utils.Settings.inject(context, {
        name: "auto-honor-settings",
        titleKey: "snooze_auto-honor",
        titleName: "Auto Honor",
        capitalTitleKey: "snooze_auto-honor_capital",
        capitalTitleName: "AUTO HONOR",
        class: "auto-honor-settings"
    });

    isEnabled = Utils.Store.get('autoHonor', 'enabled') || false;

    if (window.SnoozeManager && window.SnoozeManager.registerModule) {
        window.SnoozeManager.registerModule({
            id: 'autoHonor',
            name: 'Auto Honor',
            description: 'Automatically honors a teammate, enemy, or random player when the game finishes.',
            settings: [
                {
                    type: 'toggle',
                    id: 'sm:autoHonor',
                    label: 'Enable Auto Honor',
                    value: isEnabled,
                    onChange: (val) => toggleFeature(val)
                },
                {
                    type: 'custom',
                    render: (row) => renderExtraSettings(row)
                }
            ]
        });
    } else {
        Utils.DOM.observer.observe("lol-uikit-scrollable.auto-honor-settings", (plugin) => {
            const mainToggle = Utils.Settings.createToggleRow('Enable Auto Honor', isEnabled, (next) => {
                isEnabled = next;
                toggleFeature(next);
            });
            mainToggle.classList.add('plugins-settings-row');
            plugin.appendChild(mainToggle);

            const extraRow = document.createElement("div");
            extraRow.classList.add("plugins-settings-row");
            extraRow.style.marginTop = "10px";
            renderExtraSettings(extraRow);
            plugin.appendChild(extraRow);
        });
    }
}

async function autoHonorTeammate() {
    const currentEnabled = Utils.Store.get('autoHonor', 'enabled');
    if (!currentEnabled || !Utils.LCU) return;

    try {
        const skip = Utils.Store.get('autoHonor', 'skip') || false;
        
        // Fetch available ballot
        let ballot = await Utils.LCU.get('/lol-honor-v2/v1/ballot').catch(() => null);
        
        // Retry if empty
        if (!ballot || (!ballot.eligibleAllies?.length && !ballot.eligibleOpponents?.length)) {
            await new Promise(r => setTimeout(r, 1000));
            ballot = await Utils.LCU.get('/lol-honor-v2/v1/ballot').catch(() => null);
        }

        if (!ballot) return;

        if (skip) {
            // v2 API skip
            await Utils.LCU.post('/lol-honor-v2/v1/honor-player', {
                honorCategory: '',
                summonerId: 0
            }).catch(()=>{});
            return;
        }

        // 2. Pick candidates
        const mode = Utils.Store.get('autoHonor', 'mode') || 'allies';
        let candidates = [];
        
        if (mode === 'allies') candidates = ballot.eligibleAllies;
        else if (mode === 'enemies') candidates = ballot.eligibleOpponents;
        else if (mode === 'random') candidates = [...ballot.eligibleAllies, ...ballot.eligibleOpponents];
        
        const voteCount = ballot.votePool?.votes || 1;

        if (candidates && candidates.length > 0) {
            // Shuffle candidates
            const shuffled = [...candidates].sort(() => 0.5 - Math.random());
            
            for (let i = 0; i < Math.min(voteCount, shuffled.length); i++) {
                const target = shuffled[i];
                
                // Use v1 HEART honor
                await Utils.LCU.post('/lol-honor/v1/honor', {
                    honorType: 'HEART',
                    recipientPuuid: target.puuid
                }).catch(err => Utils.Debug.error('[AutoHonor] Vote failed:', err));
                
                // Delay between votes
                if (voteCount > 1) await new Promise(r => setTimeout(r, 200));
            }
        }
    } catch(err) {
        Utils.Debug.error('[AutoHonor] Failed to process honor:', err);
    }
}

export function load() {
    if (Utils.LCU && Utils.LCU.observe) {
        Utils.LCU.observe('/lol-gameflow/v1/gameflow-phase', e => {
            const isHonorPhase = e.data === 'PreEndOfGame' || e.data === 'EndOfGame';
            if (!isHonorPhase && e.data !== 'WaitingForStats') {
                honorAttemptedForCurrentGame = false;
            }

            const currentEnabled = Utils.Store.get('autoHonor', 'enabled');
            if (!currentEnabled) return;
            if (isHonorPhase) {
                if (honorAttemptedForCurrentGame) return;
                honorAttemptedForCurrentGame = true;
                autoHonorTeammate();
            }
        });
    }
}
