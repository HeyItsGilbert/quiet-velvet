# Agent Deck status from `claude agents --json`

## Context

The Agent Deck originally derived each session's status by scraping the last lines of a WezTerm pane with `wezterm cli get-text` and matching them against regex pattern lists (`WORKING_PATTERNS` / `WAITING_PATTERNS`). This was fragile — it broke whenever Claude Code changed its UI wording — and spawned one `get-text` subprocess per pane on every activity change.

`claude agents --json` now reports live Claude Code sessions with an authoritative `status` (`idle` / `busy` / `waiting`, plus a `waitingFor` reason), including the "needs your input" signal the deck exists to surface.

## Decision

Source status from `claude agents --json`. Keep the **WezTerm pane as the unit of identity** — it is the only thing the deck can focus, and it is always uniquely clickable. Join a Session to its Pane by **`cwd`**, because on Windows WezTerm's `cli list` exposes no `pid` or `tty`; `cwd` is the only key shared between the two data sources.

When a `cwd` maps 1 pane ↔ 1 session, trust the Claude status. When the mapping is not 1:1 — a **Collision**, where two panes and/or two sessions share one directory — fall back to the old `get-text` + regex path for just those panes, since the two JSON sources cannot be paired unambiguously.

The Claude call is activity-gated: it is spawned only when a pane's WezTerm activity signature changes, preserving the deck's existing frugality (a ~2.5–3s process is not spawned every second while agents sit idle).

## Consequences

- The regex status path (`detectStatus`) is retained but demoted to a collision-only fallback; inside a Collision the native `waitingFor` reason is unavailable.
- A future WezTerm that exposes a per-pane process key on Windows would let us join by pid and retire the Collision fallback entirely.
- Background/dispatched agents (`claude agents --json --all`, which have no pane) are intentionally out of scope here — tracked separately.
