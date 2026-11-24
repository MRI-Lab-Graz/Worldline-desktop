# Nest subjects in parallel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-nesting of BIDS subject folders runs 4 subjects at a time through one batch command, with the same end state as nesting them one at a time.

**Architecture:** New curated command `nestSubdatasets` in `DataLadAdapter.runCommand`: untrack the subjects one at a time, then a pool of 4 workers runs the existing private `#nestSubdataset` per subject. The only step that touches the parent (`.gitmodules` write) goes through one in-adapter lock that the single `nestSubdataset` also uses. Trust re-check, identity guard and schema are keyed by command name. The renderer's `nestBidsCandidates` makes one batch call.

**Tech Stack:** Node built-in test runner, `node:fs/promises`, real git and git-annex.

**Spec:** docs/superpowers/specs/2026-11-24-parallel-nesting-design.md (builds on 2026-11-24-nest-subdataset-git-annex-design.md)

## Global Constraints

- Security first: fail closed. Every subject goes through the unchanged per-folder checks of `#nestSubdataset` (plain name, real folder not a link, no existing `.git`/`.datalad`/`.gitattributes`, procedure `text2git` or none). One trust re-check for the batch, git-identity guard, schema validation.
- Windows first: no shell, paths via `join`; the Windows CI job runs the same real-annex tests with several subjects at once. Cannot be hand-tested here: CI is the evidence.
- TDD: failing test first for every step, watched failing for the right reason; tests run with `npm test`.
- Zero new npm dependencies. No new setting.
- Pool size is a constant `NEST_WORKERS = 4`, with a `ponytail:` comment naming the ceiling (raise or make adaptive only if real Windows measurements say so).
- "Convert to subdataset" and the DataLad fallback are not touched.
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Changelog is only written at release (a test forbids `## Unreleased`).

## Review Focus

- Two subjects write `.gitmodules` at the same moment (measured: 8 of 16 failed at 4 at once). Pinned in Task 1 and Task 2.
- Stop pressed mid-batch: running subjects end undone (before content is in the annex) or kept (after); no new subject starts; no `.gitmodules` entry for an undone subject. Task 2.
- One subject refused or failing does not stop the others, and the result says which. Task 2.
- Adjusted branch (Windows) with several subjects at once. Task 2.
- A request with 0, a huge number, or non-string entries is refused before anything runs. Task 2.

---

### Task 1: One lock for the `.gitmodules` write

**Files:**
- Modify: `src/datalad/adapter.js` (`#nestSubdataset`, last loop; new private field/method)
- Test: `test/nest-subdataset-real-annex.test.js`

**Interfaces:**
- Consumes: existing `#nestSubdataset({ projectPath, relativePath, procedure }, runOptions)`.
- Produces: private `#withGitmodulesLock(fn)`: runs `fn` after every earlier call finished (a promise chain on the adapter instance; a failing `fn` must not block the next). Used by the single command now and by the batch in Task 2.

- [ ] **Step 1: Write the failing test** `several nestSubdataset calls at once all register in .gitmodules` in `test/nest-subdataset-real-annex.test.js`: build a project with 8 subject folders (extend `project()` use: call it once, then `mkdir` + write a file for `sub-02`..`sub-08`, commit), run `Promise.all` of 8 `adapter().runCommand('nestSubdataset', ...)` on ONE adapter instance, assert every result `ok === true` (message in the assertion: `result.stderr`) and `git config -f .gitmodules --get-regexp '\.path$'` lists 8 entries.
- [ ] **Step 2: Run it:** `node --test test/nest-subdataset-real-annex.test.js`. Expected: FAIL with `could not lock config file .gitmodules` in some results (if it passes by luck on a fast run, loop the 8 calls in a `for` of 3 fresh projects until it fails; the lock is the reason, not timing).
- [ ] **Step 3: Implement `#withGitmodulesLock(fn)`** in `src/datalad/adapter.js` and wrap the three `git config -f .gitmodules` calls of `#nestSubdataset` in it. One field `#gitmodulesQueue = Promise.resolve()`; chain with `.then(fn, fn)`-style so one failure does not poison the queue.
- [ ] **Step 4: Run the file again.** Expected: all tests PASS, including the existing 14+.
- [ ] **Step 5: Commit** `git commit -m "nestSubdataset: one lock around the .gitmodules write, so several at once cannot collide"`.

### Task 2: The batch command `nestSubdatasets`

**Files:**
- Modify: `src/datalad/adapter.js` (`CURATED_COMMANDS`, `runCommand` dispatch, new `#nestSubdatasets`), `src/datalad/schema.js`
- Test: `test/nest-subdataset-real-annex.test.js`, `test/schema.test.js`

**Interfaces:**
- Consumes: `#nestSubdataset`, `untrackPath(projectPath, relativePath)`, `#withGitmodulesLock` (Task 1), `buildCommandResult`.
- Produces: `runCommand('nestSubdatasets', { projectPath, relativePaths: string[], procedure? }, runOptions)` returning `buildCommandResult('nestSubdatasets', run)` where `run = { command: 'git', args: [], exitCode, stdout: '', stderr, failed, subjects }` and `subjects: Array<{ relativePath: string, ok: boolean, message: string }>` in request order. `failed` is true when any subject failed or the run was stopped; when `runOptions.signal?.aborted`, the result also carries `cancelled: true` and `userError.code === 'CANCELLED'` like other cancelled commands (copy what `runCommand`/`mapCommandError` do for a cancelled runner result). Progress: after each subject finishes, `runOptions.onOutput?.('Nested <n> of <total>: <relativePath>')`.
- Schema: `nestSubdatasets: { required: ['projectPath', 'relativePaths'], optional: ['procedure'] }`; `procedure` in `LEADING_DASH_FIELDS`; `relativePaths` must be an array of 1..`NEST_MAX_SUBJECTS` (constant 1000) non-empty strings, else `Invalid request for nestSubdatasets: ...` (also add `relativePaths` to the "text fields" skip list in `assertCommandRequest` next to `paths`/`tagNames`). Each entry's path rules stay in `#nestSubdataset`.

- [ ] **Step 1: Write failing schema tests** in `test/schema.test.js`: valid request accepted; `relativePaths: []`, a non-array, an entry that is a number or empty string, 1001 entries, and `procedure: '-x'` each throw. Run: FAIL `Unsupported command: nestSubdatasets`.
- [ ] **Step 2: Implement schema entries.** Run schema tests: PASS.
- [ ] **Step 3: Write failing real-annex tests** (same file as Task 1, helper `projectWith(n)` making `sub-01..sub-n`, each with a tracked file, one commit):
  - `nestSubdatasets nests 16 subjects at once and leaves what one at a time leaves`: run the batch on one project and a loop of single `nestSubdataset` calls on a second identical one; assert all subjects ok, 16 `.gitmodules` path entries, and for every subject `lf(read(.gitattributes))`, `.datalad/config` (with `withoutId`) and `git log --format=%s` equal between the two projects; then `save` on the batch project is ok and `git status --porcelain` is empty.
  - `DataLad accepts every subject nested by the batch`: `datalad subdatasets` on the batch project lists all 16.
  - `a refused subject does not stop the others`: one folder with its own `.git`; result `ok === false`, `subjects` marks that one `ok:false`, the other 15 `ok:true` and registered.
  - `a failing subject does not stop the others`: use the `failing` runner helper to fail `annex init` for one subject folder only (match on the `-C` argument); others succeed.
  - `Stop in the middle`: pass `{ signal }` from an `AbortController` aborted from `onOutput` after the first subject finishes; assert `result.cancelled === true`, no subject is half done (each subject is either fully nested and registered, or has none of `.git`/`.datalad`/`.gitattributes` and no `.gitmodules` entry), and nothing new started after the abort (count of nested < total with 16 subjects and a pool of 4).
  - `adjusted branch with several at once` (the `GIT_CONFIG_COUNT` trick used by the existing adjusted-branch test): 6 subjects, every subject's `main` has its content, parent `save` ok and records each subject's `main`.
  - `untracked and tracked subjects both work`: one subject committed in the parent (so `untrackPath` has work), one not committed; both end nested and the parent shows no ` D` entries after `save`.
- [ ] **Step 4: Run them.** Expected: FAIL `Unsupported command: nestSubdatasets` (not a test bug).
- [ ] **Step 5: Implement `#nestSubdatasets`**: add the name to `CURATED_COMMANDS`; dispatch after `assertCommandRequest`; untrack each subject in order with errors ignored (as the screen does today, the per-subject nest decides); then `const NEST_WORKERS = 4` workers pulling from a shared index, each skipping new work once `runOptions.signal?.aborted`; collect `subjects`; build the result. `// ponytail: 4 fixed (spike: 3.3x at 4); raise or adapt only on real Windows measurements.`
- [ ] **Step 6: Run the file and `npm test`.** Expected: PASS.
- [ ] **Step 7: Commit** `git commit -m "feat: nestSubdatasets nests several subjects at once (batch command)"`.

### Task 3: Guards for the new command name

**Files:**
- Modify: `src/gui/main.js` (trust re-check condition), `src/gui/renderer/identity-guard.js` (`COMMIT_COMMANDS`), `SECURITY.md`
- Test: `test/nest-subdataset-wiring.test.js`, `test/trust-wiring.test.js` (pinned regex at the "push/nesting re-check" test), `test/identity-guard.test.js`

**Interfaces:**
- Consumes: Task 2's command name.
- Produces: `nestSubdatasets` gets the same trust re-check as `nestSubdataset`, and is blocked while the git identity is incomplete.

- [ ] **Step 1: Write failing tests:** in `test/nest-subdataset-wiring.test.js`, `nestSubdatasets gets the trust re-check` (regex on `main` for `'nestSubdatasets'` inside the `recheckTrust` condition) and `nestSubdatasets is blocked while the git identity is incomplete` (`shouldBlockForIdentity('nestSubdatasets', {available:true, name:'', email:'', complete:false}) === true`); update the pinned regex in `test/trust-wiring.test.js` to expect the three-name condition. Run: FAIL.
- [ ] **Step 2: Implement** the two one-line changes in `main.js` and `identity-guard.js`, and add to the existing `nestSubdataset` sentence in `SECURITY.md`: the batch command nests several subjects at once with one trust re-check, one lock around the parent's `.gitmodules`, every subject through the same checks. (`test/security-doc.test.js` must stay green.)
- [ ] **Step 3: Run** `npm test`. Expected: PASS.
- [ ] **Step 4: Commit** `git commit -m "Trust re-check and identity guard cover nestSubdatasets"`.

### Task 4: The screen makes one batch call

**Files:**
- Modify: `src/gui/renderer/app.js` (`nestBidsCandidates`, and the overlay text in `detectAndMaybeNestBids` if it still counts per subject)
- Test: `test/nest-subdataset-wiring.test.js`

**Interfaces:**
- Consumes: `runWorkflowCommand('nestSubdatasets', { projectPath, relativePaths, procedure: BIDS_PROCEDURE }, button, label, { skipBackgroundRefresh: true })` result with `subjects`; `shouldStopSequence`; `api.linkSubdatasetSource`.
- Produces: `nestBidsCandidates` still returns `{ steps, succeeded, cancelled? }` (callers unchanged): one step per subject labelled `Nest subdataset: <path>` built from `result.subjects` (`{ ok, userError: { message } }` shaped like a command result so `renderBidsNestSummary` works), `succeeded` = paths with `ok`, then `linkSubdatasetSource` for each succeeded subject one at a time, then the unchanged parent `save`.

- [ ] **Step 1: Write failing wiring test** replacing `automatic nesting makes one nestSubdataset call per subject...`: `automatic nesting makes ONE nestSubdatasets call for all subjects`: body of `nestBidsCandidates` contains `'nestSubdatasets'`, does not contain `'nestSubdataset'` (single quotes included, so the plural does not match), does not contain `'createSubdataset'`, contains `untrackPath` zero times (the batch untracks), and has exactly one `'save'`. Run: FAIL.
- [ ] **Step 2: Implement.** On `shouldStopSequence(result)` return `{ steps, succeeded, cancelled: true }` before the parent save, as today. The overlay: no per-subject counter is available any more, so the callback `onProgress(0, total)` once before and `onProgress(total, total, null)` after; the message reads `Nesting <total> folder(s)…` (my call: the whole step takes seconds now).
- [ ] **Step 3: Run `npm test`.** Expected: PASS.
- [ ] **Step 4: Run the e2e suite locally against real Electron:** `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`. Expected: PASS (look at `e2e/electron-driver.mjs`, which mentions nesting, and `cancel-convert.e2e.mjs`; fix any that still assume the old per-subject calls).
- [ ] **Step 5: Commit** `git commit -m "Auto-nest: one batch call for all subjects"`.

### Task 5: Finish

- [ ] **Step 1:** Update the memory note `project_datalad_vs_gitannex_check.md` (spike table, batch command, still open: Windows hand test).
- [ ] **Step 2:** Final whole-branch review (fresh reviewer), then `ponytail:ponytail-audit`, `security-review` and `superpowers:verification-before-completion` per CLAUDE.md; push the branch, open the PR on GitHub, read the CI results (Windows smoke job included) before saying it is green. Claude does not merge.
