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

1. **Polling** (`src/agentDeck.js`): `useAgentDeck` runs a `setInterval` loop (default 1s) that calls `wezterm cli list --format json` to enumerate all open panes.
2. **Agent detection**: Panes are filtered by title — matches `/claude/i` or a braille/spinner prefix (`[\u2800-\u28FF\u2733]`). The latter covers Claude Code's animated spinner character.
3. **Status detection**: For each matching pane, `wezterm cli get-text --start-line -20` fetches the last 20 lines. Regex patterns classify the output as `working`, `waiting`, `idle`, or `inactive`.
4. **Project name**: Extracted from the pane title (spinner prefix stripped), falling back to the last path segment of the pane's CWD.
5. **Click to focus**: Clicking an agent calls `activatePane`, which first switches GlazeWM to the workspace containing WezTerm, then calls `wezterm cli activate-pane`.

### WezTerm Socket Handling

WezTerm on Windows uses a Unix socket at `%USERPROFILE%\.local\share\wezterm\gui-sock-*`. Without the socket path in `WEZTERM_UNIX_SOCKET`, the CLI may fail to connect.

- On first failure, `discoverSocket` globs the socket directory (via `node -e` + `fs.readdirSync`) and caches the path in a React ref (`socketRef`).
- Subsequent polls reuse the cached socket. If it goes stale (WezTerm restarted), the cache is cleared and rediscovered.
- The `wezterm` binary path is resolved once at module load via `cmd /c where wezterm` and cached as a module-level promise — avoids PATH traversal on every 1s poll.

### File I/O Constraint

Zebar runs in a **Tauri WebView** — Node.js `fs` is not available in widget JavaScript. The only OS escape hatch is `shellExec` from the `zebar` package. All file and shell operations go through it.

- File I/O (log appending, socket discovery) uses `shellExec('node', ['-e', ...])` — Node starts ~20x faster than PowerShell and needs no profile or base64 encoding.
- Shell commands must be whitelisted in `zpack.json` under `privileges.shellCommands`. Currently: `wezterm`, `cmd`, `node`.

### Key Files

| File | Purpose |
|---|---|
| `src/agentDeck.js` | `useAgentDeck` hook, WezTerm CLI calls, socket + binary path caching, status detection |
| `src/logger.js` | Structured logger — buffers up to 300 entries, flushes to `agent-deck.log` every 3s via `node` |
| `src/components/AgentDeck.jsx` | React component — compact badge view, hover-expand to per-agent buttons |

### Status Values

| Status | Meaning | Trigger patterns |
|---|---|---|
| `working` | Actively running a tool | "esc to interrupt", "thinking", "processing", "searching", etc. |
| `waiting` | Awaiting user input | "yes, allow once", "(y/n)", "approve this plan", "press enter", etc. |
| `idle` | Prompt shown, no activity | (none of the above matched) |
| `inactive` | Pane has no text | Empty output from `get-text` |
