---
id: ADR-007
title: "Use Node.js subprocess for file I/O from WebView context"
status: accepted
date: 2026-04-02
decision-makers: []
related: [ADR-005, ADR-008, ADR-011]
tags: [agent-deck, architecture, performance]
superseded-by:
---

# ADR-007: Use Node.js subprocess for file I/O from WebView context

> Backfilled on 2026-04-04. Original decision made circa 2026-04-02.

## Status

Accepted

## Context

Zebar widgets run inside a Tauri WebView. Standard Node.js APIs (`fs`, `child_process`, `path`) are not available. The only escape hatch to the host OS is `shellExec` from the `zebar` package, which spawns a subprocess and returns stdout/stderr.

The Agent Deck needs file I/O for two operations:
1. **Socket discovery** (ADR-005): Read a directory listing to find the WezTerm socket file
2. **Log flushing** (ADR-008): Append buffered log entries to `agent-deck.log`

Both require running a host-side program. The choices are PowerShell (`pwsh`) or Node.js (`node`).

## Decision

We use `shellExec('node', ['-e', <inline CJS script>])` for all file I/O operations. The inline script is a single-line CommonJS snippet passed as a string argument.

## Consequences

- **Positive:** Node starts ~20x faster than PowerShell on Windows (no profile load, no runtime initialization). No encoding ceremony — inline CJS runs directly without base64 encoding. Node is already a dependency (Vite build toolchain), so no new runtime is introduced.
- **Negative:** Inline CJS scripts are hard to read and maintain as one-liners. No syntax highlighting or linting. Errors in the inline script are harder to debug than errors in a standalone file.
- **Neutral:** Requires `node` to be whitelisted in `zpack.json` shell command privileges (ADR-011). The scripts use CommonJS (`require('fs')`) rather than ESM because Node's `-e` flag evaluates CJS by default.

## Alternatives considered

- **PowerShell (`pwsh -Command ...`):** Works but startup is ~200ms vs. ~10ms for Node. Base64 encoding is needed for complex scripts. Profile loading adds further overhead. At 3-second log flush intervals (ADR-008) this adds up.
- **Tauri `fs` plugin:** Would provide native file access in the WebView, but Zebar doesn't expose Tauri's plugin system to widget code. Not an option without upstream changes.
- **No file logging:** Eliminates the need for file I/O but removes the ability to diagnose Agent Deck issues after the fact.
