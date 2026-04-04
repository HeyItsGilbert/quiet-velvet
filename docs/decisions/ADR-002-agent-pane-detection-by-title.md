---
id: ADR-002
title: "Detect agent panes by title regex and braille spinner prefix"
status: accepted
date: 2026-04-01
decision-makers: []
related: [ADR-001, ADR-003, ADR-009]
tags: [agent-deck, detection]
superseded-by:
---

# ADR-002: Detect agent panes by title regex and braille spinner prefix

> Backfilled on 2026-04-04. Original decision made circa 2026-04-01.

## Status

Accepted

## Context

After enumerating all WezTerm panes via `wezterm cli list`, we need to identify which panes are running Claude Code. The pane metadata available from the CLI includes `title`, `cwd`, `pane_id`, and `workspace` — but no process name or environment variables.

Claude Code sets the terminal title to the project name, often prefixed with an animated braille spinner character (Unicode range U+2800–U+28FF) or a sparkle (U+2733) while working.

## Decision

We filter panes using a two-part regex test on `pane.title`:

1. `/claude/i` — matches titles containing "claude" (case-insensitive)
2. `/^[\u2800-\u28FF\u2733]\s/` — matches titles starting with a braille/spinner character followed by whitespace

A pane matching either pattern is considered a Claude Code session.

## Consequences

- **Positive:** Simple, fast, no subprocess overhead beyond the initial `list` call. Catches both explicit "Claude Code" titles and spinner-prefixed project names.
- **Negative:** Fragile if Claude Code changes its title format. Could false-positive on a pane whose title happens to contain "claude" (unlikely in practice). The braille range is empirically determined and may not cover future spinner characters.
- **Neutral:** Detection runs on already-fetched JSON data, adding negligible cost to the poll cycle.

## Alternatives considered

- **Process name matching:** Would require `wmic` or `tasklist` calls per pane to correlate PIDs — expensive and still unreliable since Claude Code runs as a Node.js process with a generic name.
- **Environment variable injection:** Setting a marker env var when launching Claude Code, then reading it from the pane. Requires modifying the launch flow and the env var isn't exposed by `wezterm cli list`.
- **Dedicated IPC:** Claude Code could announce itself on a local socket. Same problem as ADR-001's sidecar alternative — requires upstream changes.
