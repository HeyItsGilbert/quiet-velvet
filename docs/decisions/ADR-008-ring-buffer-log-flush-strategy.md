---
id: ADR-008
title: "300-entry ring buffer with 3-second batch flush for logging"
status: accepted
date: 2026-04-02
decision-makers: []
related: [ADR-007]
tags: [agent-deck, logging, performance]
superseded-by:
---

# ADR-008: 300-entry ring buffer with 3-second batch flush for logging

> Backfilled on 2026-04-04. Original decision made circa 2026-04-02.

## Status

Accepted

## Context

The Agent Deck generates frequent log entries — debug messages on every poll cycle (every 1–2 seconds), plus info/warn/error entries for socket discovery, status changes, and failures. Writing each entry to disk immediately would spawn a Node subprocess on every log call (see ADR-007), creating significant overhead.

We need a logging strategy that:
1. Captures enough history to diagnose issues
2. Doesn't impact poll cycle performance
3. Limits memory usage regardless of log volume

## Decision

The logger (`src/logger.js`) uses a 300-entry in-memory ring buffer that batch-flushes to `agent-deck.log` every 3 seconds via `setInterval`. When the buffer exceeds 300 entries, the oldest entries are dropped (splice from the front). Flushing is a no-op if the buffer hasn't been written to since the last flush (`dirty` flag).

## Consequences

- **Positive:** Amortizes subprocess spawn cost — at most one `node -e` call every 3 seconds regardless of log volume. Ring buffer caps memory at 300 entries (~30–60KB). Dirty flag skips the subprocess entirely when nothing has been logged.
- **Negative:** Up to 3 seconds of log data can be lost if the widget crashes. The 300-entry cap means high-volume debug logging can drop older entries before they're flushed. Log file grows unboundedly across sessions (no rotation).
- **Neutral:** Logs are appended (not overwritten), so the file accumulates across widget restarts. Manual cleanup or external rotation is needed for long-running use.

## Alternatives considered

- **Flush on every log call:** Simplest implementation but spawns a subprocess per entry. At debug verbosity with 1s polling, that's 5+ subprocesses per second just for logging.
- **No file logging:** Console-only logging. Works during development but provides no post-hoc diagnostics — the Zebar WebView console is not persistent.
