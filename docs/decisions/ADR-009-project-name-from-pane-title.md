---
id: ADR-009
title: "Extract project name from pane title with CWD fallback"
status: accepted
date: 2026-04-01
decision-makers: []
related: [ADR-002]
tags: [agent-deck, detection, display]
superseded-by:
---

# ADR-009: Extract project name from pane title with CWD fallback

> Backfilled on 2026-04-04. Original decision made circa 2026-04-01.

## Status

Accepted

## Context

The Agent Deck displays a human-readable project name for each Claude Code session. The data sources available from `wezterm cli list` are `title` and `cwd`. Claude Code typically sets the terminal title to the project directory name, sometimes prefixed with a braille spinner character (ADR-002).

## Decision

Project name extraction follows a two-step priority:

1. **Title-based:** Strip the braille/spinner prefix from `pane.title`. If the result is non-empty and not the generic "Claude Code", use it as the project name.
2. **CWD fallback:** If the title is unusable, parse `pane.cwd` (a `file://` URI), decode it, and use the last path segment.

## Consequences

- **Positive:** Title-based extraction is the most accurate when Claude Code sets it explicitly (reflects the actual project, not just the directory). CWD fallback handles generic titles gracefully. No additional subprocess calls needed — uses data already fetched.
- **Negative:** If Claude Code doesn't set a meaningful title, the CWD-based name may be less descriptive (e.g., a generic directory name like "src"). URI decoding of CWD can fail on edge-case paths, though a try/catch handles this.
- **Neutral:** The spinner-stripping regex must stay in sync with the detection regex in ADR-002.

## Alternatives considered

- **Parse Claude Code's own title format only:** Too brittle — the format isn't guaranteed and varies between versions.
- **Read `package.json` from CWD:** Would give the npm package name, which might be more descriptive. But requires an additional `node -e` subprocess call per agent per poll — too expensive for a display-only feature.
