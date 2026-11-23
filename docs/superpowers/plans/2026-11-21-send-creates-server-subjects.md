# Send my saves creates missing subject folders on the lab server: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user presses Send my saves on a project cloned from the lab server, every installed nested subject gets a server folder and an `origin` that match its current name, so the push cannot silently land in an old folder or fail for a new subject.

**Architecture:** One small bash script on the server (`worldline-ensure-subjects`) is the only thing the app ever runs over SSH. It re-validates everything server-side and only ever creates. The app computes the wanted origin of each subject (`<project origin>/<subject name>`), asks the script to make sure those folders exist (one SSH call), then points each subject's `origin` there; the existing `push -r` does the rest.

**Tech Stack:** Node built-ins only (zero dependencies), the computer's own `ssh` (BatchMode, key login), bash on the server, node:test, real git/git-annex/datalad in one test.

**Spec:** this conversation, 2026-11-20/21 (decisions Q1-Q7). Related: `docs/superpowers/plans/2026-11-19-connection-favorites.md`, SECURITY.md ("Everything that writes to a remote is re-checked for trust").

## Global Constraints

- Security first, fail closed. Additive only: the script and the app never delete, replace, reconfigure, force-push or pass `--existing`.
- The server script is the authority. Its root is `/datalad/mri/MRI-Lab_Repository` (override with `WORLDLINE_ROOT` for tests and other labs). A project is a direct child of the root; a subject is a direct child of a project.
- Client side: the project's `origin` must be `ssh://<host>/<root>/<project>` and lie under a saved Connection Favorite, else the step does nothing and Send behaves as today.
- No confirmation dialog (user decision). The result is reported afterwards in plain words.
- No passwords and no relaxed host-key checking: `ssh -o BatchMode=yes -o ConnectTimeout=30 -- <host> <one command string>`.
- Names: subject `^sub-[A-Za-z0-9][A-Za-z0-9+._-]{0,62}$`; project and other path segments use the existing `SEGMENT` allowlist of `src/gui/ssh-browse.js` (safe inside single quotes). No `..`, no leading `-`.
- Windows first: the client part must pass the Windows smoke job (use `datalad status` for "saved", never plain `git status` in a parent; tests bring their own git identity as in `test/merge-prism-into-nested-real-annex.test.js`).
- No new npm dependency. Plain words for users, no jargon.
- Existing guard `test/no-ssh-server.test.js` (`createSibling` is not a command) stays valid: this feature is not a datalad command, it is a fixed ssh call.

## Review Focus

- Hostile subject names (`sub-1;touch x`, `sub-$(id)`, `../x`, `sub-a b`, `-oProxyCommand=x`, non-ASCII look-alikes): refused on the client and again on the server, nothing created.
- Project outside the root, a symlink inside the root pointing out, or not a dataset: server refuses, creates nothing.
- Folder already exists: if it is a dataset, report `exists` and do nothing; if it is something else, refuse. Never touch its content.
- Partial failure with many subjects (one refused, others fine): the others are created and pointed; the result lists the refused ones; running Send again finishes the rest.
- Origin is a local path, a share, https, or ssh outside any favorite: no ssh call, no change, Send works exactly as before.
- Subject not installed (empty folder), subject that is a plain folder, zero subjects: skipped quietly.

---

## File Structure

- Create `server/worldline-ensure-subjects` (bash, executable): server-side gate verb.
- Create `src/datalad/subject-remotes.js`: pure functions (parse origin, favorite check, plan, ssh args, parse script output).
- Modify `src/datalad/adapter.js`: `prepareSubjectRemotes(projectPath, { favorites, runSsh })`.
- Modify `src/gui/main.js`, `src/gui/preload.js`: handler `adapter:prepareSubjectRemotes`.
- Modify `src/gui/renderer/app.js`: call it in the Send handler before the push; show the result line.
- Create `docs/server-setup.md`; modify `SECURITY.md`, `docs/product/researcher-workflow.md`.
- Tests: `test/ensure-subjects-script.test.js`, `test/subject-remotes.test.js`, `test/subject-remotes-real-annex.test.js`, additions to `test/trust-wiring.test.js` and a wiring test for the Send handler.

## Task 1: Server script

**Files:** Create `server/worldline-ensure-subjects`; Test `test/ensure-subjects-script.test.js` (skip on win32: it runs bash against a temporary root).

**Interfaces:**
- Produces: `worldline-ensure-subjects <project-absolute-path> <subject>...` prints one line per subject, exit 0 when every line is `created` or `exists`, exit 1 when any is `refused`, exit 2 for a bad call. Lines: `created NAME`, `exists NAME`, `refused NAME <short reason>`; a bad project prints `error <reason>`.

- [ ] **Step 1: Write the failing tests** (temp root via `WORLDLINE_ROOT`, a project made with real `git init` + a `.git` folder):
  - creates a subject folder that is a git repository with `receive.denyCurrentBranch=updateInstead` and an initialised annex, prints `created sub-001`;
  - second run prints `exists sub-001` and changes nothing (same HEAD/config);
  - an existing non-repository folder named `sub-002` is `refused`, its files untouched;
  - each hostile name from Review Focus prints `refused` and creates nothing;
  - a project outside the root, a symlink project, a project without `.git`, a relative path: `error`, exit 2, nothing created;
  - one refused name does not stop the others (exit 1, others `created`);
  - the script never contains `rm `, `rmdir`, `--force`, `--existing` (read the file, assert absent).
- [ ] **Step 2: Run** `node --test test/ensure-subjects-script.test.js`. Expected: FAIL (file missing).
- [ ] **Step 3: Implement** the script: `set -eu`, `umask` untouched (permissions are the server's policy), resolve the project with `cd -P`/`pwd -P` and require its parent to equal the resolved root, reject names by regex, `mkdir` (no `-p`), `git init -q`, `git annex init` with description `Worldline Desktop`, `git config receive.denyCurrentBranch updateInstead`; on any failure after `mkdir` remove only the folder this run created (it was empty and new), never anything else.
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Commit** `server: worldline-ensure-subjects, the only command the app runs over SSH`.

## Task 2: Client pure functions

**Files:** Create `src/datalad/subject-remotes.js`; Test `test/subject-remotes.test.js`.

**Interfaces:**
- Produces:
  - `parseServerOrigin(url: string): { host: string, path: string } | null` (reuses `parseSshAddress` from `src/gui/ssh-browse.js`; accepts `ssh://host/abs/path`, rejects everything else);
  - `underFavorite(origin: {host, path}, favorites: string[]): boolean` (a favorite is an ssh address; true when host matches and the origin path is the favorite path or below it);
  - `wantedOrigin(projectOrigin: {host, path}, subject: string): string | null` (`ssh://host/path/subject`, null if the name fails the subject regex);
  - `ensureSshArgs(origin: {host, path}, subjects: string[]): string[]` (the full ssh argv: `['-o','BatchMode=yes','-o','ConnectTimeout=30','--', host, "worldline-ensure-subjects '<path>' '<s1>' …"]`, throws on an invalid name or path);
  - `parseEnsureOutput(stdout: string): { created: string[], exists: string[], refused: { name: string, reason: string }[] }` (unknown lines ignored, never throws).
- Consumes: `parseSshAddress`, `SEGMENT` exposed from `src/gui/ssh-browse.js` (export what is needed; do not copy the regex).

- [ ] **Step 1: Write failing tests:** a table for each function with the hostile names from Review Focus (all rejected), a favorite with a trailing slash, host case, an origin under a different host (false), `ensureSshArgs` for 3 subjects equals the exact expected argv, `parseEnsureOutput` on mixed output and on garbage.
- [ ] **Step 2: Run** `node --test test/subject-remotes.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the five functions.
- [ ] **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `subject remotes: pure helpers`.

## Task 3: Adapter and wiring

**Files:** Modify `src/datalad/adapter.js`, `src/gui/main.js`, `src/gui/preload.js`, `src/gui/renderer/app.js`; Test `test/subject-remotes-adapter.test.js` (injected runner and `runSsh`), `test/trust-wiring.test.js`, `test/publish-wiring.test.js`.

**Interfaces:**
- Produces: `DataLadAdapter#prepareSubjectRemotes(projectPath: string, { remoteName: string, favorites: string[], runSsh: (args: string[]) => Promise<{code:number, stdout:string, stderr:string}> }): Promise<{ skipped?: 'no-ssh-origin' | 'not-a-favorite' | 'no-subjects', created: string[], exists: string[], refused: {name, reason}[], pointed: string[], failed?: string }>`.
- Consumes: Task 2 functions; existing `gitlinks`-style listing of installed subjects (installed = has a `.git` entry).

- [ ] **Step 1: Write failing adapter tests** with a fake runner and fake `runSsh`: (a) project origin local path: `skipped: 'no-ssh-origin'`, `runSsh` never called; (b) ssh origin outside favorites: `skipped: 'not-a-favorite'`, never called; (c) 3 installed subjects, one with origin `./sub-134001` (drifted), one with no origin, one correct: one `runSsh` call carrying the 3 names (script output `created`/`exists`), then `git remote set-url`/`add` only for the two that differ, `pointed` lists exactly those; (d) a `refused` name is not pointed and is reported; (e) ssh exit 255 sets `failed` with a plain-words message and changes no remote; (f) uninstalled subjects are not sent to the server.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `prepareSubjectRemotes`; remotes are changed with the existing runner (`git -C <subject> remote set-url|add origin <url>`), argument list only.
- [ ] **Step 4: Handler and preload:** `adapter:prepareSubjectRemotes` requires an authorized root, calls `trustGate().require(projectPath, { event })` before anything (it writes to a remote), takes `favorites` from the payload and validates them as an array of strings (max 50, each through `parseSshAddress`), passes the real `ssh` runner built like `sshExecOptions()` in `ssh-browse.js` (export a small `runSsh`). Extend `test/trust-wiring.test.js`: the handler calls the gate before the adapter.
- [ ] **Step 5: Send handler:** in `app.js`, before `runWorkflowCommand('push', …)`, call it with `favorites.map(f => f.address)` and the remote name; show one plain sentence when something was created or refused ("Created 6 subject folders on the server." / "Could not set up sub-007 on the server: <reason>. Your other saves were sent."); on `failed` continue with the push as before. Extend `test/publish-wiring.test.js`: the call comes before the push.
- [ ] **Step 6: Run** `node --test test/subject-remotes-adapter.test.js test/trust-wiring.test.js test/publish-wiring.test.js`. Expected: PASS.
- [ ] **Step 7: Commit** `Send my saves sets up the server folders of nested subjects first`.

## Task 4: Real-tools end-to-end

**Files:** Test `test/subject-remotes-real-annex.test.js` (skip when datalad/git-annex/bash missing or on win32).

- [ ] **Step 1: Write the failing test:** a local "server" root with a real project made by `datalad create` + one subject; clone it to a temp project through the adapter; rename a subject folder; save; point `git config url./.insteadOf ssh://testhost/` (via `GIT_CONFIG_GLOBAL`, with a test identity) so `ssh://testhost/<abs>` resolves to the local path; set the project `origin` to `ssh://testhost/<root>/<project>`; `runSsh` runs `server/worldline-ensure-subjects` locally with `WORLDLINE_ROOT`; run `prepareSubjectRemotes`, then `adapter.runCommand('push', { projectPath, remoteName: 'origin' })`. Assert: the new-name folder exists on the "server", holds the subject's commit and files, the old-name folder is untouched, `datalad status` of the clone says `nothing to save`, a fresh `datalad install -r` of the server project shows the renamed subject with its data.
- [ ] **Step 2: Run**; expected FAIL until Tasks 1-3 are in; then PASS. If git refuses the initial push into the empty folder, fix the script (not the test) and record the cause in the script comment.
- [ ] **Step 3: Commit** `test: renamed subject reaches the server end to end`.

## Task 5: Docs and SECURITY.md

**Files:** Create `docs/server-setup.md`; Modify `SECURITY.md`, `docs/product/researcher-workflow.md`; Test `test/docs-tutorials.test.js` additions.

- [ ] **Step 1: Write failing doc tests:** the workflow doc has a "Sending renamed or new subjects" paragraph naming the script; `docs/server-setup.md` mentions `worldline-ensure-subjects`, `chmod +t`, `receive.denyDeletes`, `receive.denyNonFastForwards`, `/etc/gitconfig`; SECURITY.md states the app's only SSH commands are the folder browser and `worldline-ensure-subjects`, additive-only, with the server as authority.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Write** the texts. Server setup lists: install the script to `/usr/local/bin` (mode 0755, owned by root); optional `WORLDLINE_ROOT`; `chmod +t` on the repository folder; the two `receive.deny*` lines in `/etc/gitconfig`; the later, separate hardening step (ForceCommand allowing only git, git-annex and this script) clearly marked "not yet recommended until tested".
- [ ] **Step 4: Run**, expect PASS. **Step 5: Commit** `docs: server setup and the new SSH command`.

## Task 6: Gate before merge

- [ ] Run the full suite `npm test`, then `ponytail:ponytail-audit` and `security-review` over the diff, then `superpowers:verification-before-completion`; open the PR, read the Windows smoke log (not the badge), hand the merge to the user.
- [ ] After merge: the user installs the script on the server (docs/server-setup.md) and tries Send once with a renamed subject; note the result in memory.

---

**Self-review:** every decision Q1-Q7 maps to a task (favorite root: T2/T3; no confirm: T3 step 5; script on server and only that command: T1/T5; admin note: T5; lockdown later: T5 text only). Names used across tasks match (`prepareSubjectRemotes`, `ensureSshArgs`, `parseEnsureOutput`, `worldline-ensure-subjects`). Not covered on purpose: ForceCommand lockdown, uploading brand-new projects, permissions/groups ("who sees what").
