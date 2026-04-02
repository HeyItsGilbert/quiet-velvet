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
