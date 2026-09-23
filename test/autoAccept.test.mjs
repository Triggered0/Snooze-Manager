import test from 'node:test';
import assert from 'node:assert/strict';

export function calculateEffectiveAcceptDelayMs(configuredDelaySeconds) {
    const raw = Number(configuredDelaySeconds);
    const validDelay = (!isFinite(raw) || raw < 0) ? 0 : raw;
    // Safe minimum of 1000ms to avoid League client audio engine infinite loop bug
    return Math.max(Math.round(validDelay * 1000), 1000);
}

export class AutoAcceptStateMachine {
    constructor({ postAccept, exitQueue, getDelay, isEnabled }) {
        this.postAccept = postAccept;
        this.exitQueue = exitQueue;
        this.getDelay = getDelay;
        this.isEnabled = isEnabled;

        this.acceptedCurrentReadyCheck = false;
        this.wasInReadyCheck = false;
        this.pendingAcceptTimer = null;
        this.watchdogActive = false;
        this.acceptCalls = 0;
        this.exitCalls = 0;
    }

    cancelPendingAccept() {
        if (this.pendingAcceptTimer !== null) {
            clearTimeout(this.pendingAcceptTimer);
            this.pendingAcceptTimer = null;
        }
    }

    triggerAccept() {
        if (!this.isEnabled()) return;
        if (this.acceptedCurrentReadyCheck) return;
        this.acceptedCurrentReadyCheck = true;
        this.wasInReadyCheck = true;

        const safeDelayMs = calculateEffectiveAcceptDelayMs(this.getDelay());
        this.cancelPendingAccept();

        this.pendingAcceptTimer = setTimeout(() => {
            this.pendingAcceptTimer = null;
            if (!this.isEnabled() || !this.acceptedCurrentReadyCheck) return;
            this.acceptCalls++;
            this.postAccept();
        }, safeDelayMs);
    }

    handleGameflowPhase(phase, exitOnDecline = false) {
        if (phase === 'Matchmaking') {
            this.watchdogActive = true;
            this.cancelPendingAccept();
            this.acceptedCurrentReadyCheck = false;
            this.wasInReadyCheck = false;
        } else if (phase === 'ReadyCheck') {
            this.triggerAccept();
        } else if (phase === 'Lobby' && this.wasInReadyCheck && exitOnDecline) {
            this.cancelPendingAccept();
            this.wasInReadyCheck = false;
            this.acceptedCurrentReadyCheck = false;
            this.watchdogActive = false;
            this.exitCalls++;
            this.exitQueue();
        } else {
            this.cancelPendingAccept();
            this.wasInReadyCheck = false;
            this.acceptedCurrentReadyCheck = false;
            this.watchdogActive = false;
        }
    }

    handleReadyCheck(data, exitOnDecline = false) {
        if (!data) return;

        if (data.state === 'InProgress') {
            if (data.playerResponse === 'None') {
                this.triggerAccept();
            } else if (data.playerResponse === 'Accepted') {
                this.acceptedCurrentReadyCheck = true;
                this.cancelPendingAccept();
            }
        } else if (data.state === 'StrangerNotReady' || data.state === 'PartyNotReady') {
            this.cancelPendingAccept();
            this.acceptedCurrentReadyCheck = false;
            this.wasInReadyCheck = false;
            if (exitOnDecline) {
                this.exitCalls++;
                this.exitQueue();
            }
        } else if (data.state === 'EveryoneReady') {
            this.cancelPendingAccept();
        }
    }

    checkWatchdog(readyCheckData) {
        if (!this.watchdogActive || !readyCheckData) return;
        if (readyCheckData.state === 'InProgress' && readyCheckData.playerResponse === 'None') {
            this.triggerAccept();
        }
    }
}

test('calculateEffectiveAcceptDelayMs enforces 1000ms minimum even if configured with 0s', () => {
    assert.equal(calculateEffectiveAcceptDelayMs(0), 1000);
    assert.equal(calculateEffectiveAcceptDelayMs(0.5), 1000);
    assert.equal(calculateEffectiveAcceptDelayMs(1), 1000);
    assert.equal(calculateEffectiveAcceptDelayMs(1.5), 1500);
    assert.equal(calculateEffectiveAcceptDelayMs(2), 2000);
    assert.equal(calculateEffectiveAcceptDelayMs(null), 1000);
    assert.equal(calculateEffectiveAcceptDelayMs(undefined), 1000);
});

test('AutoAcceptStateMachine accepts on ReadyCheck and deduplicates duplicate ticks', async () => {
    let acceptCount = 0;
    const sm = new AutoAcceptStateMachine({
        postAccept: () => { acceptCount++; },
        exitQueue: () => {},
        getDelay: () => 0, // minimum 1000ms enforced
        isEnabled: () => true
    });

    sm.handleGameflowPhase('Matchmaking');
    assert.equal(sm.watchdogActive, true);

    // First ready check event
    sm.handleReadyCheck({ state: 'InProgress', playerResponse: 'None' });
    assert.equal(sm.acceptedCurrentReadyCheck, true);
    assert.notEqual(sm.pendingAcceptTimer, null);

    // Duplicate ready check event (e.g. 1 second tick while waiting)
    const timerBefore = sm.pendingAcceptTimer;
    sm.handleReadyCheck({ state: 'InProgress', playerResponse: 'None' });
    assert.equal(sm.pendingAcceptTimer, timerBefore, 'Timer should not be reset by duplicate tick');
});

test('AutoAcceptStateMachine cleanly resets on decline and accepts subsequent pop', async () => {
    let acceptCount = 0;
    let exitCount = 0;
    const sm = new AutoAcceptStateMachine({
        postAccept: () => { acceptCount++; },
        exitQueue: () => { exitCount++; },
        getDelay: () => 0,
        isEnabled: () => true
    });

    sm.handleGameflowPhase('Matchmaking');
    // Pop 1
    sm.handleReadyCheck({ state: 'InProgress', playerResponse: 'None' });
    assert.equal(sm.acceptedCurrentReadyCheck, true);

    // Decline arrives
    sm.handleReadyCheck({ state: 'StrangerNotReady' }, false);
    assert.equal(sm.acceptedCurrentReadyCheck, false, 'Should reset acceptedCurrentReadyCheck');
    assert.equal(sm.pendingAcceptTimer, null, 'Pending timer should be cancelled on decline');

    // Pop 2 arrives right after decline
    sm.handleReadyCheck({ state: 'InProgress', playerResponse: 'None' });
    assert.equal(sm.acceptedCurrentReadyCheck, true, 'Pop 2 must be scheduled successfully');
    assert.notEqual(sm.pendingAcceptTimer, null);
});

test('AutoAcceptStateMachine watchdog catches ReadyCheck if socket dropped during Matchmaking', () => {
    let acceptCount = 0;
    const sm = new AutoAcceptStateMachine({
        postAccept: () => { acceptCount++; },
        exitQueue: () => {},
        getDelay: () => 0,
        isEnabled: () => true
    });

    // In Matchmaking
    sm.handleGameflowPhase('Matchmaking');
    assert.equal(sm.watchdogActive, true);

    // Socket dropped! No push was received.
    // Watchdog polls /lol-matchmaking/v1/ready-check:
    sm.checkWatchdog({ state: 'InProgress', playerResponse: 'None' });

    assert.equal(sm.acceptedCurrentReadyCheck, true, 'Watchdog must trigger accept');
    assert.notEqual(sm.pendingAcceptTimer, null);
});
