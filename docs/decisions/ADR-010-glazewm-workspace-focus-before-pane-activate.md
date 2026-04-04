---
id: ADR-010
title: "Focus GlazeWM workspace before activating WezTerm pane"
status: accepted
date: 2026-04-01
decision-makers: []
related: [ADR-001]
tags: [agent-deck, glazewm, wezterm, interaction]
superseded-by:
---

# ADR-010: Focus GlazeWM workspace before activating WezTerm pane

> Backfilled on 2026-04-04. Original decision made circa 2026-04-01, refined on 2026-04-01 (commit 1a7bdde).

## Status

Accepted

## Context

When a user clicks an agent in the Agent Deck, the expected behavior is that the WezTerm window comes to the foreground with the correct pane focused. GlazeWM is a tiling window manager that organizes windows into virtual workspaces — only one workspace is visible at a time.

`wezterm cli activate-pane` focuses a pane within WezTerm but has no effect on window visibility. If WezTerm is on a different workspace than the one currently displayed, the pane gets focused but the user sees nothing happen.

## Decision

The click handler performs a two-step focus sequence:

1. **GlazeWM workspace switch:** Walk the GlazeWM workspace tree to find which workspace contains the WezTerm window, then call `focus --workspace N` to switch to it.
2. **WezTerm pane activation:** Call `wezterm cli activate-pane --pane-id <id>` to focus the specific pane.

The workspace switch must happen first; pane activation follows.

## Consequences

- **Positive:** Clicking an agent always brings it into view, regardless of which workspace WezTerm is on. The two-step approach works with GlazeWM's virtual desktop model rather than fighting it.
- **Negative:** Requires knowledge of the GlazeWM workspace tree at click time. If WezTerm spans multiple workspaces (unlikely with tiling), the logic picks the first match. Adds a small delay (~50ms) for the workspace switch before pane activation.
- **Neutral:** The `activatePane` function in `agentDeck.js` currently only calls `wezterm cli activate-pane`; the GlazeWM workspace switch is handled in the React component's click handler via `output.glazewm.runCommand()`.

## Alternatives considered

- **`activate-pane` only:** Doesn't work when WezTerm is on a hidden workspace — the pane is focused but invisible.
- **OS bring-to-front API:** Would bypass GlazeWM's workspace management, potentially breaking the tiling layout. GlazeWM should own window positioning.
