---
id: ADR-004
title: "Poll WezTerm CLI at 1-second intervals"
status: accepted
date: 2026-04-01
decision-makers: []
related: [ADR-001, ADR-006, ADR-005]
tags: [agent-deck, performance, polling]
superseded-by:
---

# ADR-004: Poll WezTerm CLI at 1-second intervals

> Backfilled on 2026-04-04. Original decision made circa 2026-04-01. Default interval later relaxed to 2 seconds.

## Status

Accepted

## Context

WezTerm CLI is request-response only — there is no event stream or WebSocket that pushes pane changes. The Agent Deck must poll to detect new/removed panes and status changes. The polling cadence trades off responsiveness (how quickly status changes appear) against overhead (subprocess spawns per second).

Each poll cycle spawns at least one subprocess (`wezterm cli list`), plus one per detected agent pane (`wezterm cli get-text`). With cached binary and socket paths (ADR-005, ADR-006), each call completes in ~20ms.

## Decision

We use `setInterval` with a configurable interval (parameter to `useAgentDeck`, currently defaulting to 2 seconds). This provides responsive status updates — a user waiting for an agent to need input will see the status change within 1–2 seconds.

## Consequences

- **Positive:** Near-real-time status updates in the bar. Simple implementation with `setInterval`. Configurable if overhead becomes a concern.
- **Negative:** ~1 subprocess spawn per second minimum (more with multiple agents). Continuous background CPU/IO cost even when no agents are active. Not instant — there's up to a 2-second lag before a status change appears.
- **Neutral:** The poll function is async and naturally serializes — if a poll takes longer than the interval, the next one just starts late rather than stacking.

## Alternatives considered

- **WebSocket/event stream from WezTerm:** Would eliminate polling entirely, but WezTerm CLI doesn't expose a subscription mechanism for pane changes.
- **Longer interval (5–10s):** Lower overhead but status changes feel laggy, especially for `waiting` states where the user needs to act.
