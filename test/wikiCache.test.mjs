import test from 'node:test';
import assert from 'node:assert/strict';

const WIKI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isCacheValid(cacheEntry, now = Date.now()) {
    if (!cacheEntry || typeof cacheEntry !== 'object') return false;
    if (!cacheEntry.timestamp || !cacheEntry.data) return false;
    if (typeof cacheEntry.data !== 'object' || Object.keys(cacheEntry.data).length === 0) return false;
    return (now - cacheEntry.timestamp) < WIKI_CACHE_TTL_MS;
}

test('wiki cache validity checking with 24-hour TTL', () => {
    const now = 1700000000000;
    assert.equal(isCacheValid(null, now), false);
    assert.equal(isCacheValid({}, now), false);
    assert.equal(isCacheValid({ timestamp: now, data: {} }, now), false);

    // Fresh cache (1 hour old)
    assert.equal(isCacheValid({ timestamp: now - 3600000, data: { 1: { name: 'Annie' } } }, now), true);

    // Expired cache (25 hours old)
    assert.equal(isCacheValid({ timestamp: now - (25 * 3600000), data: { 1: { name: 'Annie' } } }, now), false);

    // Just expired (24 hours + 1 ms)
    assert.equal(isCacheValid({ timestamp: now - (WIKI_CACHE_TTL_MS + 1), data: { 1: { name: 'Annie' } } }, now), false);

    // Still valid (24 hours - 1 ms)
    assert.equal(isCacheValid({ timestamp: now - (WIKI_CACHE_TTL_MS - 1), data: { 1: { name: 'Annie' } } }, now), true);
});
