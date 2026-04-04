---
id: ADR-003
title: "Detect agent status by regex on last 20 lines of pane text"
status: accepted
date: 2026-04-01
decision-makers: []
related: [ADR-001, ADR-002]
tags: [agent-deck, detection, status]
superseded-by:
---

# ADR-003: Detect agent status by regex on last 20 lines of pane text

> Backfilled on 2026-04-04. Original decision made circa 2026-04-01.

## Status

Accepted

## Context

Once a Claude Code pane is identified, we need to classify its current state: is it actively working, waiting for user input, idle at a prompt, or inactive? This status drives the Agent Deck UI (color coding, notification badges).

Claude Code has no structured status API. The only observable is the terminal text itself. `wezterm cli get-text --start-line -20` retrieves the last 20 visible lines of a pane without reading the full scrollback.

## Decision

We read the last 20 lines of each Claude pane per poll cycle and match against two ordered regex arrays:

1. **WAITING_PATTERNS** (checked first): "yes, allow once", "(y/n)", "approve this plan", "press enter", etc.
2. **WORKING_PATTERNS**: "esc to interrupt", "thinking", "processing", "searching", etc.

If a waiting pattern matches, status is `waiting`. Else if a working pattern matches, status is `working`. If neither matches but text exists, status is `idle`. If no text is returned, status is `inactive`.

Waiting is checked first because it's the more actionable state — the user needs to respond.

## Consequences

- **Positive:** Provides four useful status levels from unstructured terminal output. Last-20-lines window reliably captures the current prompt area without expensive full-scrollback reads. Pattern arrays are easy to extend.
- **Negative:** Regex patterns are tightly coupled to Claude Code's UI strings. Any change to Claude Code's prompts (e.g., rewording "esc to interrupt") could break detection. No semantic understanding — just string matching.
- **Neutral:** Each pane requires one additional `get-text` subprocess call per poll, adding ~20ms per agent.

## Alternatives considered

- **Claude Code structured output API:** Would be ideal but doesn't exist. Would require upstream support.
- **Process signals / exit codes:** Only indicate whether Claude Code is running, not what it's doing. Too coarse for the four-status model.
- **Full scrollback analysis:** Reading the entire scrollback could provide richer history but is far more data than needed and would slow polling significantly.
