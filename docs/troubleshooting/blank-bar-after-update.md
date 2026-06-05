# Blank bar after Zebar update / restart

## Symptoms

- Zebar process is running (`Get-Process zebar` returns a PID).
- Widget windows exist and are positioned correctly (`Get-NetTCPConnection` /
  Win32 `EnumWindows` show two `Zebar - quiet-velvet / main` windows at the top
  of each monitor with the right dimensions).
- The bar itself renders nothing — fully transparent (with `transparent: true`)
  or solid black (with `transparent: false`).
- No JS error visible because there is no DOM to log into.

## Root cause

Zebar's internal asset server is hardcoded to `127.0.0.1:6124` (verified via
`strings` on `zebar.exe` — string `http://127.0.0.1:6124`). The WebView fetches
`index.html` and the JS/CSS bundle from that local server. If the listener
fails to bind, the WebView gets nothing and the window paints empty.

The bind fails because the kernel TCP table is wedged with stale entries from
prior Zebar sessions. Sequence:

1. Zebar gets force-killed (e.g. `taskkill /IM zebar.exe /F` from the GlazeWM
   shutdown command).
2. The `msedgewebview2.exe` children Zebar spawned are NOT killed by `taskkill
   /IM zebar.exe`. They become orphans.
3. Each orphan still has an open TCP connection to the (now dead) Zebar PID on
   port 6124. They sit in `CLOSE_WAIT` forever because nothing is reading from
   them.
4. The kernel keeps the listener entry around — owned by the dead PID, not
   reusable — until those `CLOSE_WAIT` connections drain.
5. Next Zebar launch logs:

   ```
   Error: Asset server failed during runtime:
     Bind(Os { code: 10048, kind: AddrInUse,
              message: "Only one usage of each socket address ..." })
   ```

   …and proceeds to create the windows anyway. Hence: visible window, no
   content.

## How to diagnose

```powershell
# Run zebar in foreground to see the asset-server bind error:
& "C:\Program Files\glzr.io\Zebar\zebar.exe" startup

# Or check the port directly:
Get-NetTCPConnection -LocalPort 6124 -State Listen
netstat -ano | Select-String ":6124"
```

Telltale signs:

- The `Listen` entry's `OwningProcess` PID is dead (`Get-Process -Id <pid>`
  returns nothing).
- Many `CLOSE_WAIT` / `FIN_WAIT_2` rows on port 6124 with PIDs that no longer
  exist.

## Fix (immediate)

Reboot. There is no reliable way to evict a stale localhost listener from the
Windows kernel TCP table without a reboot. `Restart-Service iphlpsvc` does NOT
help. Neither does killing the orphan WebViews after the fact — once their
connections are stuck in `CLOSE_WAIT`, they're already gone from process land
but not from the kernel.

## Fix (prevent recurrence)

Stop force-killing Zebar. Use `scripts/Restart-Zebar.ps1` which:

1. Stops `zebar.exe`.
2. Sweeps any `msedgewebview2.exe` whose `--user-data-dir` is under `\zebar\`
   or `\com.glzr.zebar\`. (Outlook / Teams / Slack also use WebView2 — the
   path filter avoids killing them.)
3. Waits for port 6124 to release before relaunching.

GlazeWM is configured to invoke this on shutdown (see `~/.glzr/glazewm/
config.yaml`, `shutdown_commands`):

```yaml
shutdown_commands:
  - "shell-exec pwsh -NoProfile -File C:/Users/gilbsanchez/.glzr/zebar/quiet-velvet/scripts/Restart-Zebar.ps1 -NoStart"
```

`-NoStart` skips relaunch + port wait so shutdown stays fast.

## Things that look related but aren't

These were investigated and ruled out during diagnosis:

- **Stale dist bundle.** `npm run build` is fine; the bundle on disk matches
  source. Rebuilding doesn't help if the asset server can't serve it.
- **Service Worker caching the old bundle.** Zebar's `caching` block in
  `zpack.json` does register a SW for the Nerdfonts CDN. We cleared
  `%APPDATA%\zebar\webview-cache\quiet-velvet\EBWebView\Default\Service Worker`
  — bar was still blank. SW intercepts only the URLs in `caching.rules`, not
  the bundle itself.
- **`currentWidget()` throwing at module load in `agentDeck.js`.** Hardened to
  lazy-init via `getWeztermCwd()` so a throw can't crash the whole bundle.
  Worth keeping, but wasn't the cause this time.
- **`transparent: true` compositing bug.** `transparent: false` showed the
  same blank window (just black instead of invisible). Tauri/WebView2
  transparency is fine.
- **Window position / z-order.** Windows are at correct coordinates with
  normal z-order; not hidden behind anything.

## File pointers

- Helper script: `scripts/Restart-Zebar.ps1`
- GlazeWM hook: `~/.glzr/glazewm/config.yaml` (and `config-base.yaml` if
  templated)
- Asset port (hardcoded in `zebar.exe`): `127.0.0.1:6124`
- WebView2 user-data-dir for the widget: `%APPDATA%\zebar\webview-cache\quiet-velvet\EBWebView`
- Zebar binary: `C:\Program Files\glzr.io\Zebar\zebar.exe` (v3.3.1 at time of writing)
