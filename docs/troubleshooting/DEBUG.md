# Debugging quiet-velvet / Zebar

Practical recipes for figuring out why the bar isn't behaving. Ordered roughly
from cheapest to most invasive.

## 1. Is the Zebar process even running?

```powershell
Get-Process -Name zebar -ErrorAction SilentlyContinue |
    Format-Table Id, StartTime
```

Zero rows → no Zebar. Multiple rows → orphans, kill them all (see §10).

## 2. Are the bar windows present and positioned correctly?

```powershell
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
}
"@ -ErrorAction SilentlyContinue
$zpid = (Get-Process zebar).Id
$out = @()
[W]::EnumWindows({param($h,$l)
    [uint32]$wpid = 0; [W]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null
    if ($wpid -eq $zpid) {
        $sb = New-Object Text.StringBuilder ([W]::GetWindowTextLength($h) + 1)
        [W]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
        $r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
        $script:out += [PSCustomObject]@{ Title=$sb.ToString(); Visible=[W]::IsWindowVisible($h); L=$r.L; T=$r.T; W=$r.R-$r.L; H=$r.B-$r.T }
    }; return $true
}, [IntPtr]::Zero) | Out-Null
$out | Where-Object Title -Like "*quiet*" | Format-Table -AutoSize
```

Expect one row per monitor, `Visible=True`, `H=40`, `T=0`, sane `L`/`W`. If
windows are missing → Zebar crashed before opening them; run §6.

## 3. Run Zebar in foreground to see logs

```powershell
Stop-Process -Name zebar -Force -ErrorAction SilentlyContinue
& "C:\Program Files\glzr.io\Zebar\zebar.exe" startup
```

Or for a single widget:

```powershell
& "C:\Program Files\glzr.io\Zebar\zebar.exe" start-widget-preset `
    --pack quiet-velvet --widget-name main --preset default
```

Look for `Asset server failed during runtime: Bind(...)` — that's the wedged
port (§5). Look for `Found valid widget pack at:` to confirm Zebar discovered
the pack at all.

## 4. Does the WebView render anything? — smoke test

Replace `dist/index.html` with a hardcoded HTML page; if even that doesn't
show, the bug is below the bundle (asset server, Zebar config, Tauri). If it
shows, the bug is in our React/JS.

```powershell
Copy-Item dist\index.html dist\index.html.bak -Force
@"
<!doctype html>
<html><body style="margin:0;background:red;color:#fff;font:bold 18px monospace">
<div style="height:40px;display:flex;align-items:center;padding:0 12px">SMOKE OK</div>
</body></html>
"@ | Set-Content dist\index.html -Encoding UTF8

# Restart Zebar, look at the bar.
# Then restore:
Move-Item dist\index.html.bak dist\index.html -Force
```

Pair with a temporary `transparent: false` in `zpack.json` so the window has a
default opaque background — makes "WebView running but page broken" easy to
spot (you'll see solid black instead of nothing).

## 5. Is port 6124 (Zebar's asset server) wedged?

```powershell
Get-NetTCPConnection -LocalPort 6124 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, State, OwningProcess
netstat -ano | Select-String ":6124"
```

Healthy: one `Listen` row, owned by the running zebar PID, plus a few short
`Established` rows from live WebView2 children.

Wedged: the `Listen` row's `OwningProcess` PID is dead (`Get-Process -Id <pid>`
returns nothing) and there are many `CLOSE_WAIT` / `FIN_WAIT_2` rows from
zombie PIDs. Reboot is the only reliable fix; `Restart-Service iphlpsvc` does
NOT clear it.

The port is hardcoded in `zebar.exe` — confirm:

```bash
strings "/c/Program Files/glzr.io/Zebar/zebar.exe" | grep -E "127\.0\.0\.1:6124"
```

## 6. Inspect Zebar / WebView2 process tree

```powershell
$z = Get-Process zebar
Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -like '*zebar*' -or $_.CommandLine -like '*com.glzr.zebar*' } |
    Select-Object ProcessId, ParentProcessId,
        @{N='UserDataDir';E={ if ($_.CommandLine -match 'user-data-dir="([^"]+)"') { $matches[1] } else { '?' } }} |
    Format-Table -AutoSize
```

Two distinct user-data-dirs are normal:

- `%APPDATA%\zebar\webview-cache\quiet-velvet\EBWebView` — the bar widget.
- `%LOCALAPPDATA%\com.glzr.zebar\EBWebView` — the Zebar settings UI.

Anything unparented or whose parent zebar.exe is gone is an orphan.

## 7. WebView2 cache layout

```powershell
$cache = "$env:APPDATA\zebar\webview-cache\quiet-velvet\EBWebView\Default"
Get-ChildItem $cache | Where-Object PSIsContainer |
    Select-Object Name, LastWriteTime,
        @{N='SizeMB';E={[math]::Round((Get-ChildItem $_.FullName -Recurse -File -EA SilentlyContinue | Measure-Object Length -Sum).Sum/1MB,2)}} |
    Sort-Object SizeMB -Descending | Format-Table -AutoSize
```

What to nuke when:

- `Cache`, `Code Cache`, `GPUCache`, `Dawn*Cache` — safe to delete; just HTTP
  / V8 / GPU caches. Will rebuild.
- `Service Worker` — delete if a stale SW is intercepting fetches (Zebar's
  `caching.rules` in `zpack.json` registers one).
- `Local Storage`, `Session Storage`, `IndexedDB` — preserves widget user
  prefs (`Settings` toggles). Only nuke if those are corrupt.

## 8. Verify the dist on disk matches source

```powershell
npm run build
Get-ChildItem dist, dist\assets | Format-Table Name, LastWriteTime, Length
```

If `dist/index.html` LastWriteTime is older than your last source change, the
WebView is loading stale code regardless of cache.

## 9. Does the WebView see what we expect? Local browser test

Serve `dist/` from a normal HTTP server and open in Edge / Chrome to see the
real console:

```powershell
cd dist
python -m http.server 8765
# Browse to http://127.0.0.1:8765 — open DevTools (F12).
```

The page won't fully work outside Zebar (no `window.__ZEBAR_STATE`, no
`shellExec`, etc.), but you'll see syntax errors, import failures, and
runtime crashes. `currentWidget()` will throw — that's expected.

## 10. Clean nuclear option

```powershell
.\scripts\Restart-Zebar.ps1            # stop, sweep WebView2 orphans, restart
.\scripts\Restart-Zebar.ps1 -NoStart   # just clean up
```

Manual equivalent if the script isn't available:

```powershell
Get-Process zebar -EA SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -match 'user-data-dir="?[^"]*\\(zebar|com\.glzr\.zebar)\\' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
# Wait 2s for sockets to close, then:
Start-Process "C:\Program Files\glzr.io\Zebar\zebar.exe" -ArgumentList startup
```

## 11. Agent Deck specifically

Agent Deck polls `wezterm cli list` every 2s and tags panes by status. To
debug just that subsystem:

```powershell
# Does the WezTerm CLI work standalone from the same cwd Zebar uses?
cd "$env:USERPROFILE\.local\share\wezterm"
wezterm cli list --format json | ConvertFrom-Json | Select-Object pane_id, title, cwd
```

If this returns nothing or errors, the bar will show "disconnected" in the
deck even when everything else is fine.

The hook (`useAgentDeck` in `src/agentDeck.js`) logs to the WebView console
only; there's no on-disk log file (per ADR-012). To see those logs, open the
page in a normal browser (§9) — but most of the polling logic only runs when
`shellExec` is available, so the logs of interest only exist inside the
Zebar WebView.

## 12. Don't bother with these (they don't help)

- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` —
  Zebar/Tauri overrides browser args; the port never opens.
- `Restart-Service iphlpsvc` — does not evict stuck localhost listeners.
- `netsh int ip reset` — requires reboot to take effect anyway.
- Rebuilding the bundle when the bar is blank — won't help if the asset
  server can't serve it. Run §3 first to rule that out.

## See also

- `blank-bar-after-update.md` — full root-cause writeup for the most common
  blank-bar failure mode.
- `docs/decisions/ADR-012-drop-socket-discovery-and-binary-resolution.md` —
  why Agent Deck does what it does.
