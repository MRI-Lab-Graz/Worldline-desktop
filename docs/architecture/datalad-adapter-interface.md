# DataLad Adapter Interface

This document defines the stable boundary between UI/shell code and DataLad integration logic.

Source of truth: `src/datalad/schema.js` (`COMMAND_SCHEMAS`): every command's required and optional fields. Requests are validated against it before any process starts.

## Goals

- Keep one command boundary for all DataLad operations.
- Ensure requests/results are validated before they reach UI code.
- Keep the command vocabulary small and curated (see `docs/product/researcher-workflow.md`).

## Command names

- Project: `cloneInstall`, `createProject`, `createSubdataset`, `nestSubdataset`, `nestSubdatasets`
- Data: `get`, `drop`, `verify`, `unlock`
- History: `save`, `createTag`, `restoreFileFromCommit`, `discardChanges`
- Remotes: `update`, `push`, `pushTags`, `addRemote`, `disconnectRemote`
- Branches: `createBranch`, `switchBranch`, `createBranchAt`, `merge`, `finishMerge`, `abortMerge`

`resolveConflict` and `syncSubdatasets` are adapter methods (several git calls), `resolveConflict` is reached through the `adapter:resolveConflict` IPC handler; `syncSubdatasets` is called from `runCommand` after a successful `merge` or `finishMerge`.

`nestSubdataset` (one folder) and `nestSubdatasets` (a batch, 4 folders at a time) turn subject folders into subdatasets with a fixed sequence of git and git-annex calls that writes the same files as `datalad create -c text2git` plus `save`; they are much faster than DataLad. They refuse links, paths leaving the project and procedures other than `text2git`. A folder with its own `.git`, `.datalad` or `.gitattributes` is refused with the code `NEST_NEEDS_DATALAD`, and the app then falls back to `createSubdataset`. Both are in the trust re-check list and the git-identity guard (see `SECURITY.md`).

A new command needs an entry in `COMMAND_SCHEMAS`; anything that writes to a remote must also be in the trust re-check list (see `SECURITY.md`).

## Result schema

All command calls return:

- `ok` (boolean)
- `commandName`
- `command`
- `args`
- `exitCode`
- `stdout`
- `stderr`
- `failed`
- `userError` (present when `ok` is false)
- `warnings[]` (non-fatal advisories, can be present even when `ok` is true)

The runner result shape is validated before returning to callers.

## Project classification contract

`detectProject(projectPath)` returns one of:

- `git`
- `dataset`
- `superdataset`

Detection strategy order:

1. Confirm Git worktree.
2. Probe DataLad dataset state using `datalad status`.
3. If probe is inconclusive, fall back to `.datalad/config` metadata.
4. Probe subdatasets using `datalad subdatasets`.
5. If subdataset probe is inconclusive, fall back to `.gitmodules` metadata.

## Onboarding diagnostics contract

`checkEnvironment()` includes a UI-ready `report` with:

- `severity`
- `headline`
- `summary`
- `checks[]` including status/version/details per tool
- `recoverySteps[]` with actionable setup steps

This output is intended for onboarding screens and inline setup-recovery UX.