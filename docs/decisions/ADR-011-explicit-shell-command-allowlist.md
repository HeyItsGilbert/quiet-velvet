---
id: ADR-011
title: "Explicit per-program shell command allowlist in zpack.json"
status: accepted
date: 2026-04-02
decision-makers: []
related: [ADR-001, ADR-007]
tags: [agent-deck, security, configuration]
superseded-by:
---

# ADR-011: Explicit per-program shell command allowlist in zpack.json

> Backfilled on 2026-04-04. Original decision made circa 2026-04-02.

## Status

Accepted

## Context

Zebar's `shellExec` API requires explicit whitelisting of programs that a widget is allowed to invoke. This is configured in `zpack.json` under `privileges.shellCommands`. Without an entry, `shellExec` calls for that program are rejected at runtime.

The Agent Deck needs to invoke three programs:
- `wezterm` — CLI for pane introspection and activation (ADR-001)
- `cmd` — Used for `where wezterm` binary resolution (ADR-006)
- `node` — File I/O and socket discovery (ADR-007)

## Decision

Each program has its own entry in `zpack.json` `privileges.shellCommands` with `argsRegex: ".*"` (any arguments allowed). The allowlist is:

```json
[
  { "program": "wezterm", "argsRegex": ".*" },
  { "program": "cmd", "argsRegex": ".*" },
  { "program": "node", "argsRegex": ".*" }
]
```

## Consequences

- **Positive:** Documents exactly which programs the widget can shell out to. Keeps the blast radius minimal — only three programs, all required. Makes it easy to audit what the widget can do on the host OS.
- **Negative:** `argsRegex: ".*"` is permissive per program — any arguments are allowed. A more restrictive regex could limit to specific subcommands (e.g., only `cli list` and `cli get-text` for wezterm), but this would be fragile and hard to maintain.
- **Neutral:** Adding a new program (e.g., if we needed `pwsh` in the future) requires a `zpack.json` change and widget reload.

## Alternatives considered

- **Single wildcard entry:** A catch-all that allows any program. Defeats the purpose of the allowlist and increases the security surface.
- **No restriction (if possible):** Zebar mandates the allowlist — this isn't optional. Even if it were, explicit whitelisting is good practice for a widget with OS access.
