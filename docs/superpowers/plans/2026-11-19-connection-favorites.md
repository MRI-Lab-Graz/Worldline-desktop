# Connection Favorites Implementation Plan

> **For agentic workers:** use superpowers:executing-plans. Steps use checkboxes.

**Goal:** named shortcuts (name -> address) added in Setup and chosen in Create project.
**Architecture:** pure rules in `src/gui/renderer/favorites.js`; page wiring in `app.js`; list kept in local storage.
**Tech Stack:** plain ES modules, `node --test`. No new dependencies.
**Spec:** `docs/superpowers/specs/2026-11-19-connection-favorites-design.md`

## Global Constraints
- Nothing is written outside the app; no ssh config or keys. A chosen address is only filled in, never run.
- Name 1-40 chars (trimmed), unique ignoring case; address 1-500 chars, no control characters; at most 50 favorites.
- Disk-derived strings go in with `textContent` only. Storage reads/writes are in try/catch.

## Review Focus
- Name or address with HTML (`<img onerror>`): shown as text (page-wiring test).
- Corrupt or hand-edited stored list: `cleanFavorites` drops bad entries, never throws.
- Same name in a different case or with spaces: refused as a duplicate.
- Address with a newline or other control character: refused.
- An https:// favorite chosen while Network Folder is selected: switches to Remote URL.

### Task 1: Rules (`src/gui/renderer/favorites.js`, `test/favorites.test.js`)
**Produces:** `addFavorite(list, {name, address}) -> {list} | {error}`, `removeFavorite(list, name) -> list`,
`cleanFavorites(raw) -> list`, `favoriteTarget(address) -> 'url' | 'network'`, `FAVORITES_LIMIT = 50`.
- [ ] Write tests: add trims and keeps order; duplicate (case/space-insensitive), empty/over-long name, empty/over-long
  address, control characters, and the 50 limit give `{error}` in plain words; remove; clean drops non-arrays, non-objects,
  bad entries and duplicates; `favoriteTarget('https://x')`/`'gin:...'` -> url, `'ssh://..'`, `'\\\\srv\\s'`, `'/mnt/x'`,
  `'smb://..'` -> network.
- [ ] Run, see them fail (module missing). Implement. Run, see them pass. Commit.

### Task 2: Page wiring (`index.html`, `app.js`, `styles.css`, `test/favorites-wiring.test.js`)
**Consumes:** Task 1. Key `worldlineDesktop.favorites`.
- [ ] Wiring tests (read the sources): Setup has `id="favorites-list"`, `favorites-name`, `favorites-address`,
  `favorites-add`; Create project has `id="create-favorite"` (select); app.js imports favorites.js, reads storage
  through `cleanFavorites`, and the render functions use `textContent`, not `innerHTML`.
- [ ] Run, see them fail. Add the Setup section "Connection Favorites" after Your Name and Email, the Favorite select in
  the remote panel, render + add/remove + choose handlers (choose sets the matching radio, calls `updateGetRemoteMode()`,
  fills the field, dispatches `input`). Run, see them pass. Commit.

### Task 3: Verify and PR
- [ ] `npm test` all green; look at the page in the running app if possible; push; PR with notes; read CI.
