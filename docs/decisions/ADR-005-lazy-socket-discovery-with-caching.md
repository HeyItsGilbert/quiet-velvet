---
id: ADR-005
title: "Lazy WezTerm socket discovery with caching and stale detection"
status: superseded
date: 2026-04-01
decision-makers: []
related: [ADR-001, ADR-004, ADR-006, ADR-007]
tags: [agent-deck, wezterm, performance]
superseded-by: ADR-012
---

# ADR-005: Lazy WezTerm socket discovery with caching and stale detection

> Backfilled on 2026-04-04. Original decision made circa 2026-04-01, refined on 2026-04-03.

## Status

Superseded by [ADR-012](ADR-012-drop-socket-discovery-and-binary-resolution.md)

## Context

WezTerm on Windows uses a Unix socket at `%USERPROFILE%\.local\share\wezterm\gui-sock-*` for CLI communication. Without the `WEZTERM_UNIX_SOCKET` environment variable, the CLI may fail to connect — especially when invoked from a non-WezTerm context like a Zebar WebView.

The socket filename includes a hash that changes when WezTerm restarts. We need to:
1. Find the correct socket file
2. Avoid paying the discovery cost on every poll
3. Handle WezTerm restarts gracefully (socket goes stale)

## Decision

Socket discovery is lazy and cached in a React ref (`socketRef`):

1. **First poll:** Try without `WEZTERM_UNIX_SOCKET`. If it works, no socket management needed.
2. **On first failure:** Call `discoverSocket()`, which uses `node -e` to glob the socket directory and pick the most recently modified `gui-sock-*` file. Cache the result in `socketRef`.
3. **Subsequent polls:** Reuse the cached socket path via the `WEZTERM_UNIX_SOCKET` env var.
4. **On stale socket:** If a poll fails with a cached socket, clear `socketRef` and re-discover.

## Consequences

- **Positive:** Zero discovery overhead on the hot path when the socket is cached. Handles WezTerm restarts automatically without user intervention. Graceful fallback — tries without socket first in case the env is already set.
- **Negative:** First failure after a WezTerm restart causes one missed poll cycle (discovery adds ~50ms). The glob-based discovery assumes only one WezTerm instance; multiple instances could cause the wrong socket to be chosen.
- **Neutral:** Uses a React ref rather than module-level state, so the cache is tied to the component lifecycle. Re-mounts trigger a fresh discovery.

## Alternatives considered

- **Always pass socket:** Requires discovery on every poll — unnecessary overhead once the socket is known.
- **Always discover on startup only:** Doesn't handle WezTerm restarts; the widget would need a manual reload.
- **Hardcode socket path:** Socket filename is dynamic (includes a hash); hardcoding would break on every WezTerm restart.
