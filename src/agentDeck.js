import { useState, useEffect, useRef } from 'react';
import { shellExec, currentWidget } from 'zebar';
import { log } from './logger.js';

const WEZTERM_TIMEOUT_MS = 3000;
// `claude agents --json` spawns a node-based CLI that warms in ~2.5-3s; give it
// headroom so a slow-but-successful call isn't mistaken for a failure.
const CLAUDE_TIMEOUT_MS = 6000;
const MAX_BACKOFF_MS = 30000;

// Derive USERPROFILE from the widget's html path (e.g. C:\Users\<user>\.glzr\...).
// Lazy: a throw from currentWidget() at module load would crash the whole bundle
// and leave the bar blank with no visible error. See wezterm#4456 for cwd rationale.
let _weztermCwd = null;
function getWeztermCwd() {
    if (_weztermCwd !== null) return _weztermCwd;
    try {
        const htmlPath = currentWidget().htmlPath;
        const userProfile = htmlPath.match(/^([A-Z]:\\Users\\[^\\]+)/i)?.[1] ?? '';
        _weztermCwd = `${userProfile}\\.local\\share\\wezterm`;
    } catch (e) {
        log.error('currentWidget() failed, falling back to no cwd', { message: e?.message ?? String(e) });
        _weztermCwd = '';
    }
    return _weztermCwd;
}

// Collision-only fallback: when a cwd's pane<->session mapping is not 1:1 we
// cannot pair the two JSON sources, so we classify those panes the old way by
// scraping their text. Kept deliberately; see docs/adr/0001.
const WAITING_PATTERNS = [
    /yes, allow once/i,
    /allow for this session/i,
    /\(y\/n\)/i,
    /approve this plan/i,
    /esc to cancel/i,
    /do you want to proceed/i,
    /press enter/i,
    /waiting for your/i,
];

const WORKING_PATTERNS = [
    /esc to interrupt/i,
    /thinking/i,
    /processing/i,
    /searching/i,
    /reading file/i,
    /writing file/i,
    /running command/i,
    /analyzing/i,
];

function detectStatus(text) {
    if (!text) return 'inactive';
    const lines = text.split('\n').slice(-20).join('\n');
    for (const pat of WAITING_PATTERNS) if (pat.test(lines)) return 'waiting';
    for (const pat of WORKING_PATTERNS) if (pat.test(lines)) return 'working';
    return 'idle';
}

// Map a `claude agents --json` live status onto the deck's vocabulary.
function mapClaudeStatus(status) {
    switch (status) {
        case 'busy': return 'working';
        case 'waiting': return 'waiting';
        case 'idle': return 'idle';
        default:
            // Unknown live status: assume active rather than silently report "done".
            log.warn('Unknown claude status, treating as working', { status });
            return 'working';
    }
}

// Reduce a cwd from either source to a comparable key. WezTerm reports
// `file:///C:/Users/...` with forward slashes; claude reports `C:\Users\...`.
// Windows paths are case-insensitive, so lowercase to make the join reliable.
function normalizeCwd(raw) {
    if (!raw) return '';
    let s = String(raw).replace(/^file:\/\/[^/]*/, '').replace(/\\/g, '/');
    try { s = decodeURIComponent(s); } catch { /* keep raw on malformed escapes */ }
    // WezTerm's file:/// form leaves a slash before the drive letter (/C:/...)
    // that the claude form (C:\...) lacks — strip it so the two keys match.
    s = s.replace(/^\/([a-zA-Z]:)/, '$1');
    return s.replace(/\/+$/, '').toLowerCase();
}

// Display name: prefer the (spinner-stripped) pane title, else the cwd basename.
// Uses the raw cwd so casing is preserved for display.
function deriveProjectName(pane) {
    const titleName = (pane.title || '').replace(/^[⠀-⣿✳]\s*/, '');
    if (titleName && titleName !== 'Claude Code') return titleName;
    if (pane.cwd) {
        const cleaned = pane.cwd.replace(/^file:\/\/[^/]*/, '').replace(/\\/g, '/');
        try {
            const segments = decodeURIComponent(cleaned).split('/').filter(Boolean);
            return segments[segments.length - 1] || 'unknown';
        } catch {
            const segments = cleaned.split('/').filter(Boolean);
            return segments[segments.length - 1] || 'unknown';
        }
    }
    return 'unknown';
}

async function runExec(program, args, timeoutMs, useWeztermCwd) {
    const label = `${program} ${args.slice(0, 3).join(' ')}`;
    try {
        const cwd = useWeztermCwd ? getWeztermCwd() : '';
        const result = await Promise.race([
            shellExec(program, args, cwd ? { cwd } : {}),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
            ),
        ]);
        if (result.code !== 0) {
            log.warn(`${label} exited ${result.code}`, {
                stderr: result.stderr?.slice(0, 300) || '',
                stdout: result.stdout?.slice(0, 100) || '',
            });
            return null;
        }
        log.debug(`${label} ok`, { bytes: result.stdout?.length ?? 0 });
        return result.stdout;
    } catch (e) {
        log.error(`${label} failed`, { message: e?.message ?? String(e) });
        return null;
    }
}

const weztermExec = (args) => runExec('wezterm', args, WEZTERM_TIMEOUT_MS, true);
// claude agents lists all sessions regardless of cwd, so don't pin one.
const claudeExec = (args) => runExec('claude', args, CLAUDE_TIMEOUT_MS, false);

function paneActivityKey(p) {
    // Re-evaluate (claude refresh, or collision get-text) only when one of these changes.
    return `${p.cursor_x ?? ''}:${p.cursor_y ?? ''}:${p.size?.rows ?? ''}:${p.size?.cols ?? ''}:${p.title ?? ''}`;
}

export function useAgentDeck(pollInterval = 2000) {
    const [state, setState] = useState({
        agents: [],
        counts: { working: 0, waiting: 0, idle: 0, inactive: 0 },
        connected: false,
    });
    const pollCountRef = useRef(0);
    const inFlightRef = useRef(false);
    const backoffRef = useRef(0);
    const paneCacheRef = useRef(new Map()); // paneId -> { activityKey, status } (collision fallback)
    const claudeMapRef = useRef(null);      // normalizedCwd -> [{ status, waitingFor }]
    const claudeSigRef = useRef('');        // pane activity signature behind the cached claude map

    useEffect(() => {
        let timer = null;
        let cancelled = false;

        // Collision fallback for one pane: scrape its text, activity-gated by paneCache.
        async function collisionStatus(pane) {
            const activityKey = paneActivityKey(pane);
            const cached = paneCacheRef.current.get(pane.pane_id);
            if (cached && cached.activityKey === activityKey) return cached.status;
            const text = await weztermExec(
                ['cli', 'get-text', '--pane-id', String(pane.pane_id), '--start-line', '-20']
            );
            const status = detectStatus(text);
            paneCacheRef.current.set(pane.pane_id, { activityKey, status });
            return status;
        }

        async function poll() {
            const n = ++pollCountRef.current;
            log.debug(`Poll #${n} start`);

            const listOutput = await weztermExec(['cli', 'list', '--format', 'json']);

            if (!listOutput) {
                log.warn(`Poll #${n}: no output, disconnected`);
                paneCacheRef.current.clear();
                claudeMapRef.current = null;
                claudeSigRef.current = '';
                setState({ agents: [], counts: { working: 0, waiting: 0, idle: 0, inactive: 0 }, connected: false });
                return false;
            }

            let panes;
            try {
                panes = JSON.parse(listOutput);
            } catch (e) {
                log.error(`Poll #${n}: JSON parse failed`, { message: e?.message, raw: listOutput.slice(0, 200) });
                return false;
            }

            const claudePanes = panes.filter(p =>
                p.title && (/claude/i.test(p.title) || /^[⠀-⣿✳]\s/.test(p.title))
            );
            log.debug(`Poll #${n}: ${claudePanes.length} Claude pane(s)`);

            // Drop cache entries for panes that no longer exist.
            const liveIds = new Set(claudePanes.map(p => p.pane_id));
            for (const id of paneCacheRef.current.keys()) {
                if (!liveIds.has(id)) paneCacheRef.current.delete(id);
            }

            if (claudePanes.length === 0) {
                claudeMapRef.current = null;
                claudeSigRef.current = '';
                setState({ agents: [], counts: { working: 0, waiting: 0, idle: 0, inactive: 0 }, connected: true });
                return true;
            }

            // Activity-gate the (slow) claude call: only refresh when some pane's
            // activity signature changed. A working agent animates its spinner
            // (title changes) so it refreshes every poll; idle/waiting agents are
            // stable, so claude isn't spawned. Mirrors the get-text caching pattern.
            const activitySig = claudePanes
                .map(p => `${p.pane_id}=${paneActivityKey(p)}`)
                .sort()
                .join('|');

            if (claudeMapRef.current === null || activitySig !== claudeSigRef.current) {
                const cjson = await claudeExec(['agents', '--json']);
                if (cjson !== null) {
                    try {
                        const sessions = JSON.parse(cjson).filter(s => s.kind === 'interactive');
                        const map = new Map();
                        for (const s of sessions) {
                            const key = normalizeCwd(s.cwd);
                            const entry = { status: mapClaudeStatus(s.status), waitingFor: s.waitingFor ?? null };
                            if (!map.has(key)) map.set(key, []);
                            map.get(key).push(entry);
                        }
                        claudeMapRef.current = map;
                        claudeSigRef.current = activitySig;
                        log.debug(`Poll #${n}: claude refresh`, { sessions: sessions.length });
                    } catch (e) {
                        log.error(`Poll #${n}: claude JSON parse failed`, { message: e?.message, raw: cjson.slice(0, 200) });
                        // Keep the prior (stale) map rather than wiping all statuses.
                    }
                } else {
                    log.warn(`Poll #${n}: claude call failed; reusing prior map`);
                }
            } else {
                log.debug(`Poll #${n}: claude cache reuse`);
            }

            const claudeMap = claudeMapRef.current || new Map();

            // Group panes by cwd so we can detect collisions (mapping not 1:1).
            const panesByCwd = new Map();
            for (const pane of claudePanes) {
                const key = normalizeCwd(pane.cwd);
                if (!panesByCwd.has(key)) panesByCwd.set(key, []);
                panesByCwd.get(key).push(pane);
            }

            const agents = [];
            for (const pane of claudePanes) {
                const key = normalizeCwd(pane.cwd);
                const panesHere = panesByCwd.get(key) || [pane];
                const sessionsHere = claudeMap.get(key) || [];

                let status;
                let waitingFor = null;
                if (panesHere.length === 1 && sessionsHere.length === 1) {
                    // 1 pane <-> 1 session: trust the authoritative claude status.
                    status = sessionsHere[0].status;
                    waitingFor = sessionsHere[0].waitingFor;
                } else if (sessionsHere.length === 0) {
                    // Pane qualifies as an agent but no live session backs its cwd.
                    status = 'inactive';
                } else {
                    // Collision: can't pair sources by cwd alone, scrape this pane.
                    status = await collisionStatus(pane);
                    log.debug(`Pane ${pane.pane_id} collision status: ${status}`);
                }

                agents.push({
                    paneId: pane.pane_id,
                    agentType: 'claude',
                    status,
                    waitingFor,
                    cwd: pane.cwd || '',
                    title: pane.title || '',
                    projectName: deriveProjectName(pane),
                });
            }

            const counts = { working: 0, waiting: 0, idle: 0, inactive: 0 };
            for (const agent of agents) {
                if (counts[agent.status] !== undefined) counts[agent.status]++;
            }

            log.debug(`Poll #${n}: done`, { counts, agents: agents.length });
            setState({ agents, counts, connected: true });
            return true;
        }

        async function tick() {
            if (cancelled) return;

            // Skip when widget is hidden — saves work and process spawns.
            if (typeof document !== 'undefined' && document.hidden) {
                log.debug('Tick skipped: document hidden');
                schedule(pollInterval);
                return;
            }

            // Belt-and-suspenders guard against overlapping polls.
            if (inFlightRef.current) {
                log.warn('Tick skipped: previous poll still in flight');
                schedule(pollInterval);
                return;
            }

            inFlightRef.current = true;
            let success = false;
            try {
                success = await poll();
            } catch (e) {
                log.error('poll() threw', { message: e?.message ?? String(e) });
            } finally {
                inFlightRef.current = false;
            }

            if (success) {
                backoffRef.current = 0;
                schedule(pollInterval);
            } else {
                // Exponential backoff: 2s -> 4s -> 8s -> ... capped at MAX_BACKOFF_MS.
                backoffRef.current = backoffRef.current
                    ? Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)
                    : pollInterval * 2;
                log.info('Backoff engaged', { nextMs: backoffRef.current });
                schedule(backoffRef.current);
            }
        }

        function schedule(ms) {
            if (cancelled) return;
            timer = setTimeout(tick, ms);
        }

        function onVisibility() {
            if (!document.hidden && !inFlightRef.current) {
                log.debug('Visibility regained, polling immediately');
                clearTimeout(timer);
                tick();
            }
        }

        log.info('useAgentDeck mount', { pollInterval });
        document.addEventListener('visibilitychange', onVisibility);
        tick();

        return () => {
            log.info('useAgentDeck unmount');
            cancelled = true;
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [pollInterval]);

    function activatePane(paneId) {
        log.info('activatePane', { paneId });
        return weztermExec(['cli', 'activate-pane', '--pane-id', String(paneId)]);
    }

    return { ...state, activatePane };
}
