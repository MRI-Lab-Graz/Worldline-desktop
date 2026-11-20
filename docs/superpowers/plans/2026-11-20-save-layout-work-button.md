# Save layout and "Work on this project" bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Message-first Save panel with changes (left) and check result (right), and a full-width "Work on this project" toggle bar.

**Architecture:** Markup and CSS only. All element ids, `describeSaveValidity`, Save gating and the tools show/hide JS stay unchanged. The bar's open/closed label is driven by CSS from `aria-expanded`.

**Tech Stack:** Plain HTML/CSS/JS renderer, Node built-in test runner (`npm test`); tests are text checks on `index.html` / `styles.css`.

**Spec:** `docs/superpowers/specs/2026-11-20-save-layout-work-button-design.md`

## Global Constraints

- A fresh "not valid" still blocks Save; stale/unchecked never block (no change to `save-gating.js` / `project-card.js`).
- Plain words, no jargon. Works at narrow width (no horizontal scroll).
- Decorative arrows stay in `<span aria-hidden="true">`.
- Windows first: no change may rely on hover-only or macOS-only behaviour.

## Review Focus

- Non-BIDS project: validity step hidden, "What changed" must span the full width (not half).
- Narrow window: two columns collapse to one, message still first.
- PRISM project: right column says "PRISM and BIDS" (already from `describeSaveValidity`).
- Failed check: problem list still shown under the right column and Save still blocked.
- Tools open: bar remains visible, reads "Hide tools", `aria-expanded="true"`.

---

### Task 1: Save panel: message first, two columns below

**Files:**
- Modify: `src/gui/renderer/index.html:426-470` (Save panel)
- Modify: `src/gui/renderer/styles.css` (near `.save-validity-text`, ~line 2285-2310)
- Modify (tests): `test/save-area-page.test.js`

**Interfaces:**
- Consumes: existing ids `save-step-changes`, `save-step-valid`, `save-validity-*`, `message`, `save-guidance`, `use-suggestion`, `message-nudge`, `save-project`.
- Produces: wrapper `<div class="save-grid">` containing `save-step-changes` then `save-step-valid`.

- [ ] **Step 1: Update tests first (they must fail)** in `test/save-area-page.test.js`:
  - Replace test "Save is three steps in order" with "Save is message first, then changes and check side by side, then the button": order `id="save-step-message"` < `class="save-grid"` < `id="save-step-changes"` < `id="save-step-valid"` < `id="save-project"`; keep the `What did you do, and why?`, `hidden` on `save-step-valid`, and `Save this step` asserts.
  - In "the validity step has its text…": the three ids must lie between `id="save-step-valid"` and `id="save-project"` (not before `save-step-message`).
  - Replace "step numbers are counted by the page" with "the columns carry no step numbers": `assert.doesNotMatch(panel, /save-step-num/)`.
  - Add "the two columns share the row and collapse when narrow or when one is hidden": `assert.match(css, /\.save-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(/)`.
  - Add "the message box is bigger than a normal field": `assert.match(css, /#message\s*\{[^}]*font-size:\s*1\.1rem/)`.
- [ ] **Step 2: Run** `node --test test/save-area-page.test.js` — Expected: the new/changed tests FAIL (order, `save-grid` missing, `save-step-num` present).
- [ ] **Step 3: Edit `index.html`:** move the `save-step-message` label, `message-nudge`, `save-guidance` and `use-suggestion` above the two sections; wrap `save-step-changes` and `save-step-valid` in `<div class="save-grid">`; remove the three `<span class="save-tip save-step-num"></span>`; keep the "Check again" button inside `save-step-valid`. Keep `save-project` button after the grid.
- [ ] **Step 4: Edit `styles.css`:** add `.save-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }` (auto-fit lets a hidden validity step leave "What changed" full width); `#message { font-size: 1.1rem; padding: 0.8rem 1rem; }`; make the validity heading smaller (`#save-valid-title { font-size: 0.95rem; }`); delete the now-unused `.save-step-num::before` and `counter-reset` rules.
- [ ] **Step 5: Run** `npm test` — Expected: all PASS.
- [ ] **Step 6: Look at it** in the real app (`run` skill): BIDS project, non-BIDS project, narrow window, a failing check. Report what you saw, including what you could not check (Windows).
- [ ] **Step 7: Commit** `git add -A && git commit -m "Save: message first, changes and check side by side"` (end with the Co-Authored-By line).

### Task 2: Full-width "Work on this project" toggle bar

**Files:**
- Modify: `src/gui/renderer/index.html:375` (button moves out of `strip-state-group`)
- Modify: `src/gui/renderer/styles.css` (new `.work-bar` rules)
- Modify (tests): `test/home-tools-layout.test.js`, `test/project-card.test.js:~100`, `test/status-polish.test.js:~42`

**Interfaces:**
- Produces: `<button id="open-tools" class="button button-primary work-bar" ...>` as its own row in the project part of the strip, directly after the identity/state row and before `id="project-strip-now"`. It holds `<span class="work-bar-main"><span class="work-bar-open">Work on this project <span aria-hidden="true">▸</span></span><span class="work-bar-close">Hide tools <span aria-hidden="true">▾</span></span></span>` and `<span class="work-bar-hint">Files, Sync, History, Health, Branches &amp; Ignore</span>`.
- `aria-controls="project-tools"`, `aria-expanded` unchanged; no JS change.

- [ ] **Step 1: Update tests first:**
  - `test/project-card.test.js`: keep the open-tools asserts (text, `button-primary`, aria) and add `assert.match(tools, /work-bar/)`; the button must still sit before `project-strip-now`.
  - `test/status-polish.test.js` "only the last-action group stacks": the `tools` group lookup no longer exists. Change to `assert.ok(last)` and `assert.doesNotMatch(html, /<div class="strip-state-group[^"]*">[^]*?id="open-tools"/)`-style check that `open-tools` is not inside a `strip-state-group` (slice the group's inner HTML as the test already does and assert it does not include `id="open-tools"`).
  - `test/home-tools-layout.test.js`: widen the arrow regex to `[←▸▾]`; add "the Tools bar shows Hide tools while open": css matches `/\.work-bar\[aria-expanded="true"\]\s*\.work-bar-open\s*\{[^}]*display:\s*none/` and `/\.work-bar-close\s*\{[^}]*display:\s*none/` plus `/\.work-bar\[aria-expanded="true"\]\s*\.work-bar-close\s*\{[^}]*display:\s*inline/`; add "the bar is a big tap target": `.work-bar` rule has `width: 100%` and `min-height: 3.25rem`.
- [ ] **Step 2: Run** `npm test` — Expected: the changed/new tests FAIL.
- [ ] **Step 3: Implement** the markup and CSS above. `.work-bar`: `display:flex; flex-direction:column; align-items:center; width:100%; min-height:3.25rem; font-size:1.15rem; font-weight:700`; `.work-bar-hint` smaller (0.85rem, reduced opacity); `.work-bar-close{display:none}`; the two `aria-expanded="true"` rules as in the tests. Remove the open-tools button from the badge group.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Look at it** in the real app: closed shows "Work on this project ▸", click, shows "Hide tools ▾" and the bar stays; keyboard Tab/Enter works; narrow window.
- [ ] **Step 6: Commit** `git add -A && git commit -m "Work on this project: full-width toggle bar"` (with Co-Authored-By line).

## Before merge (repo rules)
Run `ponytail:ponytail-audit`, `security-review`, `superpowers:verification-before-completion`; read the CI results (including the Windows job) before saying it is green. Claude cannot merge PRs.
