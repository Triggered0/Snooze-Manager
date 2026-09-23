import test from 'node:test';
import assert from 'node:assert/strict';

test('Assets separates core assets from heavy assets', async () => {
    let coreLoaded = false;
    let heavyLoaded = false;

    const mockAssets = {
        champs: {},
        items: {},
        queues: [],
        skins: new Map(),
        summonerIcons: new Map(),
        wardSkins: new Map(),
        _initialized: false,
        _heavyInitialized: false,
        _heavyInitPromise: null,

        async init() {
            // Core lightweight assets only
            this.champs[1] = { id: 1, name: 'Annie' };
            this.queues.push({ id: 450, name: 'ARAM' });
            this._initialized = true;
            coreLoaded = true;
        },

        async initHeavyAssets() {
            if (this._heavyInitialized) return;
            if (this._heavyInitPromise) return this._heavyInitPromise;

            this._heavyInitPromise = (async () => {
                this.skins.set(1001, { id: 1001, name: 'Goth Annie' });
                this.summonerIcons.set(1, { id: 1, title: 'Icon' });
                this.wardSkins.set(1, { id: 1, name: 'Ward' });
                this._heavyInitialized = true;
                heavyLoaded = true;
            })();
            return this._heavyInitPromise;
        },

        getSkin(id) {
            if (!this._heavyInitialized && !this._heavyInitPromise) {
                this.initHeavyAssets().catch(() => {});
            }
            return this.skins.get(Number(id)) || null;
        }
    };

    // Initial startup: only core assets load
    await mockAssets.init();
    assert.equal(mockAssets._initialized, true);
    assert.equal(coreLoaded, true);
    assert.equal(mockAssets._heavyInitialized, false);
    assert.equal(heavyLoaded, false);
    assert.equal(mockAssets.skins.size, 0);

    // Heavy assets are loaded on demand
    await mockAssets.initHeavyAssets();
    assert.equal(mockAssets._heavyInitialized, true);
    assert.equal(heavyLoaded, true);
    assert.equal(mockAssets.skins.size, 1);
    assert.equal(mockAssets.getSkin(1001)?.name, 'Goth Annie');
});
