# Save panel layout and "Work on this project" bar (design)

Small change, approved in chat 2026-11-20.

## Why
Students need the commit message to be the obvious thing in Save; the validity box
takes too much room. The "Work on this project" button looks like a badge, so people
miss that it opens all other actions.

## Goals
- Save panel: message field first and larger; below it two columns:
  left "What changed" (file list, All/None), right the check result
  ("BIDS" or "PRISM and BIDS" when `project.json` is at the root), with "Check again".
- One column on narrow windows.
- "Work on this project" becomes a full-width primary bar under the project title,
  about twice as tall, with a short hint of what is inside. It stays visible as a
  toggle ("▾ Hide tools" while open); aria-expanded kept.

## Non-goals / anti-goals
- No change to validation rules. A fresh "not valid" still blocks Save (fail closed).
  Stale or unchecked results still never block. Problem list still shown on failure.
- No new PRISM detection: `describeSaveValidity` already knows `check.kind`.
- BIDS/PRISM badges stay where they are, as plain status.

## Approaches
1. Reorder/restyle the existing markup and CSS (chosen): smallest diff, reuses
   `describeSaveValidity`, ids and gating unchanged.
2. Rebuild the panel as a new component: more code, risks the Save gate. Rejected.

## Left to the builder
Exact sizes and wording of the hint line; Windows/narrow-width check; tests for any
new text logic (e.g. PRISM line, toggle label) written first.
