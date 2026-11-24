# Nest subjects with git/git-annex instead of DataLad

## Why
Opening a BIDS project nests every `sub-*` folder into its own dataset. Measured on OpenNeuro ds000001 (16 subjects, macOS): DataLad 51-56 s, plain git/git-annex 16-19 s. Each subject costs two DataLad start-ups (`create`, then `save`) of about 3.2 s against about 1.1 s. Priorities: security > usability > Windows first.

## Goals
- Auto-nest becomes about 3x faster with the same end state: DataLad still lists the subject as a subdataset, status is clean, `save`, `get`, push and clone work.
- Everything that guards the old path still guards the new one.

## Non-goals
- No change to `save`, the parent save (it keeps the PRISM/BIDS validator gate), `run`, `push`, `update`, `get`, `drop`.
- The "Convert to subdataset" button stays on `createSubdataset` + `save`.

## Approaches
- **A (chosen):** one new command `nestSubdataset` in the adapter, a fixed sequence of git/git-annex calls. The auto-nest loop calls it instead of `createSubdataset` + `save`.
- B: also do the parent save with git. Rejected: would skip or duplicate the validator gate.
- C: reimplement `createSubdataset` and `save` themselves. Rejected: `save` is every Save in the app.

## Design
`nestSubdataset {projectPath, relativePath, procedure?}` (procedure: only `text2git` or none), run under `runCommand` so it keeps cancel, activity display and result shape. Steps, same files DataLad writes:
1. Validate: `isSafeRelativeSubdatasetPath`; the folder is a real directory (not a symlink) and has no `.git`. Otherwise refuse (fail closed).
2. `git init -b main`, `git annex init`.
3. Write `.gitattributes` (MD5E backend, `**/.git* annex.largefiles=nothing`, plus the `* annex.largefiles=((mimeencoding=binary)and(largerthan=0))` line for text2git), `.datalad/config` (`datalad.dataset.id` = random UUID), `.datalad/.gitattributes`. Commit "[DATALAD] new dataset".
4. `git annex add .`, commit "Add existing <path> content".
5. Register in the parent: `.gitmodules` entry (`path`, `url = ./<path>`, `datalad-id`) via `git config -f`; the parent save commits it later.

Wiring: `main.js` trust re-check list, `identity-guard` COMMIT_COMMANDS, `schema.js` (required/optional, leading-dash check), renderer auto-nest loop.

## Tests (red first)
Real git/git-annex (skip if absent, as `nested-source-real-annex.test.js`): file contents equal a DataLad-created subject; DataLad `subdatasets` lists it and `status` is clean after the parent save; refusal cases (symlink, existing `.git`, bad path, bad procedure); wiring tests for the gate lists. Windows CI must pass; a Windows hand test is still open.

## Left to the builder
Exact git flags per platform (e.g. `core.symlinks` on Windows) as the real-annex test shows.
