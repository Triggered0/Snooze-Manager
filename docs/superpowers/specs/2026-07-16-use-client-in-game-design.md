# Use Client In Game — Design

**Date:** 2026-07-16
**Status:** Approved (design), pending implementation plan

## Problem

While a League game is running, the client renders the `rcp-fe-lol-game-in-progress`
route as a full-window blocker ("game is still in progress") and locks the user to it.
The user wants to keep browsing the client — Profile, Collection, match history — during
a live game, while still being able to reconnect if the game client crashes.

## Goal

A new, optional module that dismisses the in-progress blocker during a live game so the
user can navigate the client read-only, and automatically restores the blocker when the
game needs a reconnect.

## Non-Goals

- No new queue / lobby / matchmaking actions. Browsing stays read-only. The client already
  gates matchmaking while a game is `InProgress`, so no extra enforcement is coded.
- No spectate, no in-game overlay, no changes to the game client itself.
- No unrelated refactoring of existing modules.

## Module

- **File:** `modules/useClientDuringGame.js`
- **id:** `useClientDuringGame`
- **Display name:** `Use Client In Game`
- **Default:** OFF
- Standalone-installable like every other module (native-settings fallback path when the
  manager loader is absent).

## Behavior — event-driven on gameflow phase

`load()` subscribes to the gameflow phase:

```js
Utils.LCU.observe('/lol-gameflow/v1/gameflow-phase', (e) => { ... })
```

State transitions (only act when the module toggle is enabled):

| Phase | Action |
|-------|--------|
| `InProgress` | Inject the scoped `<style>` — hide the blocker, restore navigation. |
| `Reconnect`  | Remove the style so the in-progress screen + Reconnect button return. |
| any other    | Remove the style (idempotent). |

- Toggle turned OFF while `InProgress` → remove the style immediately (re-show blocker).
- `unload()` (or module disabled) → remove the style. Clean teardown, no leftover DOM.

`Reconnect` is a distinct gameflow phase the client enters when the game process is gone
but the match is still live — this is exactly the "re-show on need" trigger.

## Mechanism

**Approach A — scoped CSS (primary).**
Inject a single `<style>` element with a stable id (pattern already used by
`modeSelectorTweaks`). Rules:
- hide `.rcp-fe-lol-game-in-progress`
- un-hide / re-enable the top nav bar so nav clicks route normally

Add/remove the whole `<style>` node on phase transitions — no per-element mutation to
track or clean up.

**Selector confirmation.** Exact selectors for the nav bar hidden during a game and any
viewport overlay are confirmed against the live client during implementation. Known anchor:
`.rcp-fe-lol-game-in-progress` (already queried by `gameAnalysisPopup`).

**Approach B — EmberHook nav guard (documented fallback, not built unless needed).**
If CSS alone leaves navigation Ember-locked (clicks ignored), add a small `EmberHook`
patch to stop the gameflow route force-navigating to the in-progress route while
`InProgress`. Higher break risk on client updates, so only introduced if A proves
insufficient in live testing.

## Settings

Single toggle, wired the same way as `autoQueue`:
- `init(context)` calls `Utils.Settings.inject(context, { name, titleKey, titleName, ... })`.
- Registers via `window.SnoozeManager.registerModule({ id: 'useClientDuringGame', name,
  description, settings: [{ type: 'toggle', ... }] })`.
- Native-menu fallback (`Utils.DOM.observer.observe(...)`) when `SnoozeManager` loader is
  absent, matching existing modules.

Toggle state stored via `Utils.Store.get/set('useClientDuringGame', 'enabled')`.

## Wiring — `index.js`

1. `import * as useClientDuringGameModule from './modules/useClientDuringGame.js';`
   (alongside the other module imports, ~line 1613).
2. Init dispatch (~line 1748):
   `if (!_initDisabledIds.has('useClientDuringGame')) useClientDuringGameModule.init(ctx);`
3. Load dispatch (~line 1785):
   `if (!_disabledIds.has('useClientDuringGame')) useClientDuringGameModule.load();`

## README

Add a module bullet, e.g.:
`Use Client In Game`: Dismiss the "game in progress" screen so you can browse the client
during a live game; the screen returns automatically when a reconnect is needed.

## Testing

Manual, against the live client (no automated harness in this repo):
1. Enable module, start a game → blocker hidden, nav usable, Profile/Collection reachable.
2. Kill the game client mid-match → phase goes `Reconnect`, blocker + Reconnect button return.
3. Toggle OFF during a game → blocker returns immediately.
4. Disable module / reload → no leftover `<style>`, client behaves stock.
5. Game ends normally (`WaitingForStats` → `EndOfGame`) → no leftover style, normal flow.
