import test from 'node:test';
import assert from 'node:assert/strict';
import { findPlayerInSession } from '../modules/gameAnalysisPopup.js';
import { getModeKey } from '../modules/SnoozeBalanceTooltip.js';

test('getModeKey correctly maps ARAM and ARAM: Mayhem (KIWI) to aram', () => {
    assert.equal(getModeKey('ARAM'), 'aram');
    assert.equal(getModeKey('aram'), 'aram');
    assert.equal(getModeKey('KIWI'), 'aram');
    assert.equal(getModeKey('kiwi'), 'aram');
    assert.equal(getModeKey('CHERRY'), 'ar');
    assert.equal(getModeKey('ARENA'), 'ar');
    assert.equal(getModeKey('URF'), 'urf');
    assert.equal(getModeKey('unknown_mode'), null);
});

test('findPlayerInSession matches by cellId across string/number types', () => {
    const session = {
        myTeam: [
            { cellId: 0, summonerId: 100, puuid: 'p-0', championId: 10 },
            { cellId: 1, summonerId: 101, puuid: 'p-1', championId: 20 },
            { cellId: 2, summonerId: 102, puuid: 'p-2', championId: 30 }
        ]
    };

    // Number cellId
    const foundNum = findPlayerInSession(session, { type: 'cellId', value: 1 });
    assert.notEqual(foundNum, null);
    assert.equal(foundNum.championId, 20);

    // String cellId (common from DOM or Ember component attributes)
    const foundStr = findPlayerInSession(session, { type: 'cellId', value: '1' });
    assert.notEqual(foundStr, null);
    assert.equal(foundStr.championId, 20);
});

test('findPlayerInSession matches by summonerId across string/number types', () => {
    const session = {
        myTeam: [
            { cellId: 0, summonerId: 18201828, puuid: 'p-user', championId: 99 }
        ]
    };

    const found = findPlayerInSession(session, { type: 'summonerId', value: '18201828' });
    assert.notEqual(found, null);
    assert.equal(found.championId, 99);
});

test('findPlayerInSession matches by PUUID case-insensitively', () => {
    const session = {
        myTeam: [
            { cellId: 0, summonerId: 100, puuid: 'ABCD-1234-EFGH', championId: 44 }
        ]
    };

    const found = findPlayerInSession(session, { type: 'puuid', value: 'abcd-1234-efgh' });
    assert.notEqual(found, null);
    assert.equal(found.championId, 44);
});

test('findPlayerInSession falls back to gameData.teamOne if myTeam is missing', () => {
    const session = {
        gameData: {
            teamOne: [
                { cellId: 0, summonerId: 501, puuid: 'p-501', championId: 77 }
            ]
        }
    };

    const found = findPlayerInSession(session, { type: 'summonerId', value: 501 });
    assert.notEqual(found, null);
    assert.equal(found.championId, 77);
});

test('findPlayerInSession returns null when player cannot be found', () => {
    const session = {
        myTeam: [
            { cellId: 0, summonerId: 100, puuid: 'p-0' }
        ]
    };

    assert.equal(findPlayerInSession(session, { type: 'cellId', value: 99 }), null);
    assert.equal(findPlayerInSession(null, { type: 'cellId', value: 0 }), null);
});
