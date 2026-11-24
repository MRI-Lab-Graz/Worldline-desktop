# Nest subject folders in parallel: design

Date: 2026-11-24. Status: for approval. Builds on `2026-11-24-nest-subdataset-git-annex-design.md` (the single-subject command, merged in #107).

## Why
Opening a downloaded BIDS project nests every `sub-*` folder. With `nestSubdataset` that is about 1 s per subject, one after another. A 16-subject project waits about 12–18 s; a 100-subject project waits well over a minute. The work per subject is independent (its own `.git`, its own `annex add`), so it can overlap.

## Measured (throwaway spike, 16 subjects of OpenNeuro ds000001, macOS)

| At once | Nest time | Result |
|---|---|---|
| 1 | 12.0 s | clean |
| 2 | 6.2 s | clean |
| 4 | 3.6 s | 8 of 16 failed |
| 8 | 2.0 s | 5 of 16 failed |

Every failure had one cause: two subjects wrote `.gitmodules` at the same moment and git's lock (`could not lock config file .gitmodules`) refused the second. Untracking the subjects in the parent (`git rm --cached` + commit, about 1.8 s for 16) must also stay one at a time.

## Goals
- Nest several subjects at once, with exactly the same result on disk as nesting them one at a time (same files, same parent state).
- One trust re-check, one Stop, one progress count for the whole step, as today's single step has.
- No new setting. Nothing for the user to learn.

## Non-goals / anti-goals
- Not parallel for the DataLad fallback ("Convert to subdataset" with a folder that has its own git files) or for any other command. Convert nests one folder and stays as it is.
- No speed-up at the cost of a half-nested folder: a Stop or a failure must leave the same state the single command leaves (undo before content enters the annex, keep after).
- No change to the parent `save` (validator gate).

## Constraints
- Security first: the batch is a fixed sequence of git/git-annex calls like `nestSubdataset`; every subject goes through the same per-folder checks (plain name, real folder not a link, no existing `.git`/`.datalad`/`.gitattributes`, procedure `text2git` or none). Same trust re-check, git-identity guard and schema validation, keyed by the new command name.
- Windows first: the adapter tests must pass on the Windows CI job with several subjects at once (adjusted-branch sync, file locking, antivirus). I cannot hand-test Windows, so CI is the evidence.

## Approaches
- **A. Several `nestSubdataset` calls from the screen.** Small change, but 4 trust scans at once, 4 runs to stop, and the screen's "already running" guard has to be bypassed. Rejected.
- **B. One batch command `nestSubdatasets` (chosen by Karl).** The adapter runs a small pool. One trust re-check, one run id, one Stop, one progress stream.
- **C. Do nothing.** Costs about 8–12 s on a 16-subject project. Rejected by Karl.

## Design (B)
- **Command:** `nestSubdatasets { projectPath, relativePaths: string[], procedure? }`. Added to the curated commands, the schema (array of strings, each checked with the same leading-dash and path rules; an upper limit on the list length so one request cannot be unbounded), `COMMIT_COMMANDS` in the identity guard, and the trust re-check list in `main.js`.
- **Order inside the adapter:**
  1. Untrack, one subject at a time (reuse `untrackPath`; as today a failure there is not fatal, the per-subject nest decides).
  2. A pool of 4 workers takes subjects from the list and runs the existing per-subject steps (init, annex init, files, commit, annex add, commit, adjusted-branch sync) unchanged.
  3. The `.gitmodules` entry (three `git config -f` calls) is the only step that touches the parent, so it goes through one lock inside the adapter (a promise chain): never two at once. The existing single `nestSubdataset` uses the same lock.
- **Stop:** the one signal reaches every running git call; workers take no new subject once it is aborted; each running subject ends the way the single command does (undone before content is in the annex, kept after).
- **One failure does not stop the others.** The result lists, per subject, ok or the refusal/failure message; overall `ok` only when all succeeded.
- **Progress:** the adapter reports how many subjects are done (the number the screen shows), through the same channel `get` uses for its count.
- **Screen:** `nestBidsCandidates` calls the batch once, builds its `steps`/`succeeded` lists from the per-subject results, runs `linkSubdatasetSource` for each succeeded subject (still one at a time, unchanged), then the parent `save` as today.
- **Number of workers:** 4, a constant (`ponytail:` comment: raise or make adaptive only if measurements on real Windows machines say so). 4 gave 3.3x in the spike; 8 adds little and risks disk and antivirus contention.

## Tests (TDD, real git-annex like the existing nest tests)
- Batch of 16 subjects at 4 at once: `.gitmodules` has all 16 entries, each subject is a dataset DataLad accepts, parent state equals the sequential run's (compared with the same normalisation the existing tests use).
- Lock: the old collision reproduced (red) before the lock exists.
- A refused subject (e.g. one with its own `.git`) and a failing subject do not stop the others; the result says which.
- Stop in the middle: running subjects end per the undo/keep rule, no new subject starts, no `.gitmodules` entry for an undone subject.
- Adjusted-branch simulation (`GIT_CONFIG_*` crippled filesystem) with several at once.
- Wiring: schema, identity guard, trust re-check, screen uses one batch call, SECURITY.md line.
- Windows: the same adapter tests run on the CI Windows job.

## Left to the builder
Exact result shape for the per-subject list, the list-length limit, how progress reaches the screen, and the e2e test update (the e2e suite has a fake-datalad convert test that must keep working).

## Not covered
Real Windows hand test (no machine available); behaviour on slow disks (USB stick, network drive) where more at once may not help.
