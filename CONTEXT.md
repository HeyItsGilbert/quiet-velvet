# Agent Deck

The Agent Deck is the part of Quiet Velvet that tracks running Claude Code sessions and shows their status in the bar. This glossary fixes the language for how a terminal pane, a Claude session, and a displayed agent relate.

## Language

**Agent**:
A Claude Code session surfaced in the deck. Its identity is the **Pane** it runs in — that is what makes it uniquely clickable and focusable.
_Avoid_: instance, process (when you mean the displayed entry)

**Pane**:
A WezTerm terminal pane, as reported by `wezterm cli list`. The unit of identity and the only thing the deck can focus. A pane qualifies as an **Agent** by its **title** (matches `/claude/i` or a spinner prefix), never by cwd.
_Avoid_: window, tab, terminal

**Session**:
A live Claude Code process, as reported by `claude agents --json`. Carries the authoritative **Status**. Has no pane reference of its own — it is joined to a **Pane** only by `cwd`.
_Avoid_: agent (a Session is not the displayed entry; an Agent is)

**Status**:
The state shown for an Agent: `working`, `waiting`, `idle`, or `inactive`.
- `working` — Session is `busy` (actively running).
- `waiting` — Session is `waiting` on the user (carries a `waitingFor` reason, e.g. "permission prompt").
- `idle` — Session is `idle` (prompt shown, no activity).
- `inactive` — pane qualifies as an Agent but has no live Session.
_Avoid_: busy (that is the raw Claude term; the deck's term is `working`)

**Collision**:
A `cwd` whose Pane↔Session mapping is not 1:1 — more than one Agent pane and/or more than one Session share that directory. Because Pane and Session share no key but `cwd` (WezTerm exposes no pid/tty on Windows), a Collision cannot be resolved from the two JSON sources alone.

## Example dialogue

— "VM-Actions shows two waiting agents, but I only have one pane there."
— "Then that's not a Collision on the pane side. One pane, two sessions in that cwd — the mapping still isn't 1:1, so we can't trust the cwd join. We read the pane's text directly to get its real status."
— "And if there were two panes and two sessions?"
— "Same conclusion: a Collision. We fall back to reading each pane's text rather than guessing which session is which."
