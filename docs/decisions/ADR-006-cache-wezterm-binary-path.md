---
id: ADR-006
title: "Resolve and cache WezTerm binary path at module load"
status: superseded
date: 2026-04-02
decision-makers: []
related: [ADR-001, ADR-004, ADR-005]
tags: [agent-deck, wezterm, performance]
superseded-by: ADR-012
---

# ADR-006: Resolve and cache WezTerm binary path at module load

> Backfilled on 2026-04-04. Original decision made circa 2026-04-02.

## Status

Superseded by [ADR-012](ADR-012-drop-socket-discovery-and-binary-resolution.md)

## Context

Every WezTerm CLI call needs the binary path. On Windows, `cmd /c where wezterm` resolves the full path by searching PATH directories. With 1–2 second polling (ADR-004) and 1+ subprocess calls per cycle, running `where` on every invocation adds measurable overhead.

Multiple calls can race during initialization — if `useAgentDeck` mounts and the first poll fires before the binary is resolved, concurrent calls could each trigger their own `where` lookup.

## Decision

We resolve the WezTerm binary path exactly once at module load time using a module-level promise (`_weztermBinPromise`). The `getWeztermBin()` function creates the promise on first call and returns the cached promise on subsequent calls. The promise resolves to the first line of `where wezterm` output, falling back to the bare string `"wezterm"` on any error.

## Consequences

- **Positive:** PATH traversal happens exactly once, regardless of how many polls or concurrent calls occur. The promise pattern naturally deduplicates concurrent first-calls. Fallback to `"wezterm"` means the system degrades gracefully if `where` fails.
- **Negative:** If WezTerm is installed after the widget loads, the cached path won't update until the widget is reloaded. An unlikely edge case in practice.
- **Neutral:** The resolution happens eagerly on first import of `agentDeck.js`, before any poll runs. This is intentional — it front-loads the cost.

## Alternatives considered

- **Hardcode full path (e.g., `C:\Program Files\WezTerm\wezterm.exe`):** Breaks if installed elsewhere. Not portable.
- **Resolve on every `shellExec` call:** Adds ~10ms per call. At 1s polling with multiple CLI calls per cycle, this is noticeable.
