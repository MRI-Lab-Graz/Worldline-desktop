# Connection Favorites (short design, approved 2026-11-19)

**Why:** students and colleagues should pick a place by name (e.g. `Datalad-server`, `OpenNeuro`) instead of typing
or remembering addresses.

**Goals:** add/remove named favorites in Setup; choose one in Create project > Based on a remote dataset, which fills
the right field. **Non-goals:** changing anything on the system (no `~/.ssh/config`, no keys: SSH is set up by the user
beforehand), a lab-shared or admin-supplied list, default favorites, auto-running anything.

**Approaches considered:** (A) per-user list in the page's local storage, like recent projects (chosen: smallest, no
new file, no new IPC); (B) JSON file written by the main process (more plumbing, no extra safety because every
address is checked again when used); (C) admin-supplied list (needs policy plumbing nobody asked for).

**Design**
- `src/gui/renderer/favorites.js`: pure rules. `addFavorite(list, {name, address})`, `removeFavorite(list, name)`,
  `cleanFavorites(raw)` (drops anything invalid when loading), `favoriteTarget(address)` -> `'url'` for https://, gin:,
  `'network'` for everything else (ssh://, folder paths, UNC, smb://).
- Name: 1-40 characters after trimming, unique ignoring case. Address: trimmed, 1-500 characters, no control
  characters. At most 50 favorites.
- Setup > Connection Favorites: list (name, address, Remove) and an Add form. Text only, via `textContent`.
- Create project remote panel: a Favorite dropdown. Choosing one switches to the matching mode and fills the field,
  then fires `input`. Nothing runs until the user clicks Create. The address is checked exactly as if typed (ssh
  address check, trust prompt).
- Stored under one local-storage key; reading is try/catch and falls back to an empty list.
