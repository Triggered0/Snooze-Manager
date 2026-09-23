import test from 'node:test';
import assert from 'node:assert/strict';

function calculateEffectiveAcceptDelayMs(configuredDelaySeconds) {
    const raw = Number(configuredDelaySeconds);
    const validDelay = (!isFinite(raw) || raw < 0) ? 0 : raw;
    // Safe minimum of 1000ms to avoid League client audio engine infinite loop bug
    return Math.max(Math.round(validDelay * 1000), 1000);
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
