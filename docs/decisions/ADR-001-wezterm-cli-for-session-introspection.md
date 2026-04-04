---
id: ADR-001
title: "Use WezTerm CLI for Claude Code session introspection"
status: accepted
date: 2026-04-01
decision-makers: []
related: [ADR-002, ADR-004, ADR-005, ADR-006]
tags: [agent-deck, wezterm, architecture]
superseded-by:
---

# ADR-001: Use WezTerm CLI for Claude Code session introspection

> Backfilled on 2026-04-04. Original decision made circa 2026-04-01.

## Status

Accepted

## Context

The Agent Deck needs to discover and monitor Claude Code sessions running in WezTerm terminal panes. The widget runs inside a Tauri WebView (Zebar), which has no direct access to the host OS process table or terminal internals. We need a way to:

1. List all open terminal panes and their metadata (title, CWD, pane ID)
2. Read recent terminal output to determine session status
3. Focus a specific pane when the user clicks on an agent

WezTerm provides a `wezterm cli` tool that communicates with the running WezTerm instance over a local Unix socket. It supports `list --format json` (enumerate panes), `get-text` (read pane content), and `activate-pane` (focus a pane).

## Decision

We use `wezterm cli list` and `wezterm cli get-text` as the sole introspection mechanism. All calls go through Zebar's `shellExec` API since Node.js `fs` and `child_process` are not available in the WebView.

## Consequences

- **Positive:** Zero additional dependencies — WezTerm CLI ships with WezTerm. Works with any terminal content (not coupled to Claude Code internals). JSON output from `list --format json` is easy to parse.
- **Negative:** Requires spawning a subprocess on every poll cycle. The CLI is a synchronous request-response tool — no event stream, so we must poll (see ADR-004). Tightly coupled to WezTerm; would not work with other terminals without a new adapter.
- **Neutral:** CLI availability depends on WezTerm being installed and its binary being on PATH (see ADR-006 for how this is handled).

## Alternatives considered

- **WezTerm IPC/WebSocket API:** WezTerm exposes a multiplexer protocol, but it's undocumented for external consumers and would require implementing a custom client inside the WebView — far more complexity for the same data.
- **Process enumeration (e.g., `tasklist`, `wmic`):** Could detect Claude Code processes, but gives no pane-level information (title, CWD, terminal text). Insufficient for status detection.
- **Dedicated Claude Code sidecar:** A separate process that Claude Code communicates with. Would provide richer data but requires changes to Claude Code itself and adds deployment complexity.
