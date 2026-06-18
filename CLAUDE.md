# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Quiet Velvet is a custom Windows taskbar/status bar widget built with [Zebar](https://github.com/glzr-io) (a widget toolkit for GlazeWM tiling window manager). It's a React + Vite app that renders as a transparent overlay bar at the top of the screen.

## Build Commands

```bash
npm run build       # Production build (outputs to dist/)
npm run dev         # Watch mode — rebuilds on file changes
npm run serve       # Vite dev server
```

After any code change, run `npm run build` then reload Zebar to see updates.

## Architecture

- **Entry point**: `index.html` loads `src/main.jsx`, which creates Zebar provider groups (keyboard, glazewm, cpu, date, battery, memory, weather, host) and renders the `App` component.
- **Zebar providers**: `zebar.createProviderGroup()` supplies live system data (CPU, memory, battery, weather, date, GlazeWM workspaces). The `output` state object holds all provider data.
- **Widget config**: `zpack.json` defines the Zebar widget manifest — name, dimensions (100% width, 40px height), transparency, and monitor selection. This replaced the old `main.zebar.json`.
- **User config**: `src/config.js` holds user-specific secrets and paths (Spotify tokens, explorer path, powershell path). This file is gitignored and must be created manually from the template in the README.

### Components (src/components/)

| Component | Purpose |
|---|---|
| `SpotifyWidget.jsx` | Shows currently playing song; hover for playback controls |
| `GoogleSearch.jsx` | Inline Google search; opens browser on workspace 3 |
| `Shortcut.jsx` | Clickable buttons that run GlazeWM commands (focus workspace + launch app) |
| `Settings.jsx` | Gear icon to toggle widget visibility; persists to localStorage |

### Key Files

- `src/utils.js` — Spotify API helpers (token refresh, fetch current song, skip/previous/play-pause). Uses localStorage for access token caching.
- `styles.css` — All styling. CSS custom properties `--main-color`, `--font-color`, `--background-color` control the theme. Uses Nerd Fonts for icons.

## GlazeWM Integration

Widgets interact with GlazeWM via `output.glazewm.runCommand()` — this sends commands like `focus --workspace N` or `shell-exec <path>`. Shortcuts and the Google Search widget both use this pattern.

## Agent Deck

The Agent Deck monitors Claude Code sessions running in WezTerm panes and displays their status in the bar.

### How It Works

1. **Polling** (`src/agentDeck.js`): `useAgentDeck` runs a self-scheduling loop that calls `wezterm cli list --format json` every poll to enumerate all open panes.
2. **Agent detection**: Panes are filtered by title — matches `/claude/i` or a braille/spinner prefix (`[\u2800-\u28FF\u2733]`). The latter covers Claude Code's animated spinner character. Detection stays title-based on purpose — a pane is never identified as an agent by its cwd.
3. **Status**: Sourced from `claude agents --json` (filtered to `kind:"interactive"`), mapped `busy`→`working`, `waiting`→`waiting` (with its `waitingFor` reason), `idle`→`idle`. Sessions are joined to panes by **normalized cwd** — on Windows WezTerm exposes no pid/tty, so cwd is the only key shared between the two sources. The claude call is **activity-gated**: spawned only when a pane's activity signature (title/cursor/size) changes, so idle agents cost nothing extra.
4. **Collision fallback**: when a cwd's pane↔session mapping is not 1:1 (multiple panes and/or sessions in one directory), those panes fall back to `wezterm cli get-text` + regex classification (`detectStatus`). A qualifying pane whose cwd has no live session is `inactive`. See `docs/adr/0001`.
5. **Project name**: Extracted from the pane title (spinner prefix stripped), falling back to the last path segment of the pane's CWD.
6. **Click to focus**: Clicking an agent calls `activatePane`, which first switches GlazeWM to the workspace containing WezTerm, then calls `wezterm cli activate-pane`.

### WezTerm Socket Handling

WezTerm on Windows uses a Unix socket at `%USERPROFILE%\.local\share\wezterm\gui-sock-*`. Without the socket path in `WEZTERM_UNIX_SOCKET`, the CLI may fail to connect.

- On first failure, `discoverSocket` globs the socket directory (via `node -e` + `fs.readdirSync`) and caches the path in a React ref (`socketRef`).
- Subsequent polls reuse the cached socket. If it goes stale (WezTerm restarted), the cache is cleared and rediscovered.
- The `wezterm` binary path is resolved once at module load via `cmd /c where wezterm` and cached as a module-level promise — avoids PATH traversal on every 1s poll.

### File I/O Constraint

Zebar runs in a **Tauri WebView** — Node.js `fs` is not available in widget JavaScript. The only OS escape hatch is `shellExec` from the `zebar` package. All file and shell operations go through it.

- Shell commands must be whitelisted in `zpack.json` under `privileges.shellCommands`. Currently: `wezterm` (any args) and `claude` (`agents …` only). `claude` is resolved via PATH — it lives on the user PATH at `~/.local/bin`, so Zebar must run in a user session that inherits it.

### Key Files

| File | Purpose |
|---|---|
| `src/agentDeck.js` | `useAgentDeck` hook, WezTerm + `claude agents` CLI calls, cwd-join, status sourcing, collision fallback |
| `src/logger.js` | Structured logger — buffers up to 300 entries, flushes to `agent-deck.log` every 3s via `node` |
| `src/components/AgentDeck.jsx` | React component — compact badge view, hover-expand to per-agent buttons |

### Status Values

| Status | Meaning | Source |
|---|---|---|
| `working` | Actively running | claude `busy` (collision: working regex patterns) |
| `waiting` | Awaiting user input | claude `waiting` + `waitingFor` reason (collision: waiting regex patterns) |
| `idle` | Prompt shown, no activity | claude `idle` (collision: no pattern matched) |
| `inactive` | Pane qualifies but no live session | cwd has no `claude agents` session |
