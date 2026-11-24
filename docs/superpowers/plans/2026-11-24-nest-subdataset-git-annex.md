# Nest subjects with git/git-annex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-nesting of BIDS subject folders uses one git/git-annex command per subject instead of DataLad `create` + `save`, about 3x faster, same end state.

**Architecture:** New curated command `nestSubdataset` handled in `DataLadAdapter.runCommand` before `#buildCommand`: a fixed sequence of git/git-annex runner calls returning one `buildCommandResult`. Trust re-check, identity guard and schema validation are keyed by command name, so the new name is added to those lists. The auto-nest loop in the renderer calls it; the parent `save` (validator gate) and the "Convert to subdataset" button stay on DataLad.

**Tech Stack:** Node built-in test runner, `node:fs/promises`, `node:crypto` (`randomUUID`), real git and git-annex.

**Spec:** docs/superpowers/specs/2026-11-24-nest-subdataset-git-annex-design.md

## Global Constraints

- Security first: fail closed; refuse a symlinked folder or one that already has `.git`; `procedure` only `text2git` or absent; relative path must pass `isSafeRelativeSubdatasetPath`.
- Windows first: no shell, no POSIX-only calls, paths via `join`; Windows CI job must pass.
- TDD: failing test first for every step; tests run with `npm test`.
- Zero new npm dependencies.
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Written files byte-identical to DataLad's: `.gitattributes` (MD5E rule, `**/.git* annex.largefiles=nothing`, and for text2git `* annex.largefiles=((mimeencoding=binary)and(largerthan=0))`), `.datalad/config` (`[datalad "dataset"]\n\tid = <uuid>\n`), `.datalad/.gitattributes` (`config annex.largefiles=nothing\n`), `.gitmodules` entry with `path`, `url = ./<path>`, `datalad-id`. Commit messages `[DATALAD] new dataset` and `Add existing <path> content`.

## Review Focus

- Folder name with spaces or non-ASCII (Windows): nests and DataLad lists it.
- Subject folder that is empty: nests with no content commit failing.
- Subject folder containing a `.git` entry (a dropped-in repository): refused, nothing written.
- Subject folder that is a symlink: refused.
- Cancelled midway (Stop): returns a cancelled failure, leaves a state the old path's retry ("Convert to subdataset") can still handle.

---

### Task 1: `nestSubdataset` in the adapter

**Files:**
- Modify: `src/datalad/adapter.js` (add to `CURATED_COMMANDS`; branch at the top of `runCommand` after validation; private `#nestSubdataset(request, runOptions)`)
- Modify: `src/datalad/schema.js` (schema entry `nestSubdataset: { required: ['projectPath','relativePath'], optional: ['procedure'] }`; add `nestSubdataset: ['procedure']` to `LEADING_DASH_FIELDS`)
- Test: `test/nest-subdataset-real-annex.test.js`

**Interfaces:**
- Produces: `adapter.runCommand('nestSubdataset', { projectPath, relativePath, procedure? }, runOptions)` returning the usual `buildCommandResult('nestSubdataset', …)`; `args` shows the failing step; on refusal a failed result with `userError` (code `NEST_REFUSED`, plain-words message).

- [ ] **Step 1: Write the failing tests** in `test/nest-subdataset-real-annex.test.js` (skip when git-annex or datalad missing, same `has`/`hasTools` helper as `test/nested-source-real-annex.test.js`; each builds a temp git project with `sub-01/anat/T1w.nii` and `sub-01/func/events.tsv`, committed identity configured):
  - `nestSubdataset matches what DataLad writes`: nest one subject with `nestSubdataset` and a second copy with `createSubdataset`+`save`; assert the three files and `.gitmodules` entry equal apart from the uuid, and `git annex find --include='*'` lists the same files.
  - `DataLad accepts a subject nested with git-annex`: after `nestSubdataset` then the parent `save`, `datalad subdatasets` lists `sub-01` and `datalad status` prints nothing dirty; `get` of a file works.
  - `refuses a folder that already has .git`, `refuses a symlinked folder`, `refuses a bad procedure` (`'../x'`), `refuses a path leaving the project` (`'../out'`): each asserts `ok === false`, `userError.code === 'NEST_REFUSED'`, and that nothing was written (no `.gitattributes` in the folder).
  - `nests a folder with spaces and non-ASCII in its name` and `an empty folder`.
- [ ] **Step 2: Run** `node --test test/nest-subdataset-real-annex.test.js`. Expected: FAIL, "Unsupported command: nestSubdataset".
- [ ] **Step 3: Implement** `#nestSubdataset(request, runOptions)`: validate (path, `lstat` real directory, no `.git`, procedure ∈ {undefined,'text2git'}); then, each via `this.runner.run('git', ['-C', folder, …], runOptions)` stopping at the first failure or cancel: `init -q -b main`, `annex init`, write files (`writeFile`, LF endings), `add -- .datalad .gitattributes`, `commit -m "[DATALAD] new dataset"`, `annex add .`, commit `Add existing <path> content` (skip when nothing to commit), then `git -C projectPath config -f .gitmodules submodule.<path>.{path,url,datalad-id}`. Also `git -C folder config annex.` nothing else. One line why: files are copied from DataLad so DataLad treats it as its own.
- [ ] **Step 4: Run** the new file, then `npm test`. Expected: PASS, 0 failed.
- [ ] **Step 5: Commit** `feat: nest a subject with git/git-annex (adapter command)`.

### Task 2: Guards by command name

**Files:**
- Modify: `src/gui/main.js` (the `recheckTrust` condition: also `nestSubdataset`)
- Modify: `src/gui/renderer/identity-guard.js` (`COMMIT_COMMANDS`: add `nestSubdataset`)
- Test: `test/nest-subdataset-wiring.test.js`

**Interfaces:**
- Consumes: command name from Task 1.

- [ ] **Step 1: Write the failing tests** (source-reading style as `test/nested-source-wiring.test.js`): `main.js` trust re-check covers `nestSubdataset`; `shouldBlockForIdentity('nestSubdataset', {available:true, complete:false})` is true.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the two one-line additions.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: guard nestSubdataset like createSubdataset`.

### Task 3: Auto-nest loop uses it

**Files:**
- Modify: `src/gui/renderer/app.js` (`nestBidsCandidates`, ~lines 1150-1200: replace the `createSubdataset` and subject `save` calls by one `runWorkflowCommand('nestSubdataset', { projectPath, relativePath: candidatePath, procedure: BIDS_PROCEDURE }, …)`; step label `Nest subdataset: <path>`; keep untrack before, `linkSubdatasetSource` after, parent save after the loop)
- Test: `test/nest-subdataset-wiring.test.js`

- [ ] **Step 1: Write the failing test**: the auto-nest function's source calls `'nestSubdataset'` and no longer `'createSubdataset'`; the Convert handler still calls `'createSubdataset'`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the swap; progress overlay text unchanged.
- [ ] **Step 4: Run** `npm test`. Expected: PASS; then time the flow on OpenNeuro ds000001 with the saved `worldline-flow.sh` idea (open the app flow via adapter calls) and record seconds in the PR.
- [ ] **Step 5: Commit** `feat: auto-nest uses one git-annex command per subject`.

### Task 4: Docs and PR

**Files:**
- Modify: `SECURITY.md` (one line: nesting runs fixed git/git-annex commands in a folder only after the trust check; refuses symlinks and existing `.git`)
- Modify: `docs/superpowers/specs/…` none.

- [ ] **Step 1: Run** the `ponytail:ponytail-audit`, `security-review` and `superpowers:verification-before-completion` skills over the branch; handle or decline findings.
- [ ] **Step 2: Push, open PR**, wait for CI (Windows smoke included), read the logs. User merges unless asked.

## Self-review
Spec coverage: command + files + refusals (T1), guards (T2), wiring + Convert untouched (T3), tests incl. DataLad acceptance and Windows CI (T1, T4). Names consistent: `nestSubdataset`, `NEST_REFUSED`.
