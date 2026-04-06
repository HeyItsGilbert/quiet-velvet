---
id: ADR-012
title: "Drop socket discovery and binary path resolution in favor of bare wezterm CLI"
status: accepted
date: 2026-04-06
decision-makers: []
related: [ADR-001, ADR-005, ADR-006, ADR-007, ADR-008, ADR-011]
tags: [agent-deck, wezterm, simplification]
superseded-by:
---

# ADR-012: Drop socket discovery and binary path resolution in favor of bare wezterm CLI

## Status

Accepted (supersedes ADR-005, ADR-006, ADR-007, and ADR-008)

## Context

ADR-005 introduced lazy socket discovery with caching — globbing `%USERPROFILE%\.local\share\wezterm\gui-sock-*` via a `node -e` subprocess, caching the result in a React ref, and passing it as `WEZTERM_UNIX_SOCKET` on every CLI call. ADR-006 added a one-time `cmd /c where wezterm` resolution to avoid PATH traversal on each poll. ADR-007 and ADR-008 described the `node`-based file I/O strategy for flushing logs to disk.

In practice:

1. **Socket discovery was unnecessary.** The WezTerm CLI finds its own socket when run from the correct working directory (`~/.local/share/wezterm`). See [wezterm#4456](https://github.com/wezterm/wezterm/issues/4456#issuecomment-2286974918).
2. **Binary path resolution was fragile.** The resolved full path (e.g., `C:\Program Files\WezTerm\wezterm.exe`) contained backslashes that required escaping, and Zebar's shell permission model (ADR-011) whitelists programs by name — a full path doesn't match the `"wezterm"` entry in `zpack.json`.
3. **Node.js subprocess for file I/O was no longer needed.** With socket discovery removed, the only remaining use of `node` was the log flush to disk. Console-only logging is sufficient for a widget.
4. **`process.env` is unavailable in Tauri WebView.** Both socket discovery and the logger relied on `process.env.USERPROFILE`, which doesn't exist in Zebar's runtime. The user profile path is instead derived from `currentWidget().htmlPath`.

## Decision

Remove socket discovery, binary resolution, and file-based logging entirely:

- **No socket discovery.** No `discoverSocket()` function, no `socketRef`, no `WEZTERM_UNIX_SOCKET` env var passing. Instead, set `cwd` to `~/.local/share/wezterm` on every `shellExec` call so the CLI finds its own socket.
- **No binary path resolution.** Use the bare string `'wezterm'` as the program name. This matches the allowlist in `zpack.json` and lets the OS resolve via PATH.
- **CWD derived from widget path.** Since `process.env` is unavailable in the Tauri WebView, the user profile is extracted from `currentWidget().htmlPath` (e.g., `C:\Users\<user>\.glzr\...` → `C:\Users\<user>`).
- **Console-only logging.** The file flush via `node -e` is removed. The logger retains its in-memory ring buffer and writes to `console.log`/`console.error` only.
- **Reduced shell allowlist.** `cmd` and `node` are removed from `zpack.json` privileges — only `wezterm` is needed.

## Consequences

- **Positive:** ~80 lines of code removed across `agentDeck.js` and `logger.js`. Only one shell program (`wezterm`) needs to be allowlisted. No more `node` subprocess overhead on every log flush. No backslash escaping issues. Simpler polling loop with no retry/rediscovery logic.
- **Negative:** Logs are no longer persisted to disk — only visible in the WebView dev console. If a future environment requires explicit socket configuration, the `cwd` approach may not suffice. Deriving the user profile from the widget path assumes a `C:\Users\<user>\...` layout.
- **Neutral:** The in-memory ring buffer in the logger is retained for potential future use (e.g., exposing recent logs in the UI).

## Alternatives considered

- **Keep socket discovery but use `cwd` instead of `WEZTERM_UNIX_SOCKET`:** Still requires a `node` subprocess to glob the socket directory — same complexity.
- **Use Tauri APIs for home directory:** Zebar's `currentWidget()` exposes file paths but no explicit home directory API. Parsing `htmlPath` is the simplest available option.
- **Keep file-based logging with `wezterm cli` workaround:** No clean way to write files using only the `wezterm` binary.
