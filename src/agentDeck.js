import { useState, useEffect, useRef } from 'react';
import { shellExec, currentWidget } from 'zebar';
import { log } from './logger.js';

// Derive USERPROFILE from the widget's html path (e.g. C:\Users\<user>\.glzr\...)
const htmlPath = currentWidget().htmlPath;
const userProfile = htmlPath.match(/^([A-Z]:\\Users\\[^\\]+)/i)?.[1] ?? '';
// https://github.com/wezterm/wezterm/issues/4456#issuecomment-2286974918
const WEZTERM_CWD = `${userProfile}\\.local\\share\\wezterm`;

const EXEC_TIMEOUT_MS = 3000;
const MAX_BACKOFF_MS = 30000;

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

async function weztermExec(args) {
    const label = `wezterm ${args.slice(0, 3).join(' ')}`;
    try {
        const result = await Promise.race([
            shellExec('wezterm', args, { cwd: WEZTERM_CWD }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`timeout after ${EXEC_TIMEOUT_MS}ms`)), EXEC_TIMEOUT_MS)
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

function paneActivityKey(p) {
    // Re-poll get-text only when one of these changes.
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
    const paneCacheRef = useRef(new Map()); // paneId -> { activityKey, status }

    useEffect(() => {
        let timer = null;
        let cancelled = false;

        async function poll() {
            const n = ++pollCountRef.current;
            log.debug(`Poll #${n} start`);

            const listOutput = await weztermExec(['cli', 'list', '--format', 'json']);

            if (!listOutput) {
                log.warn(`Poll #${n}: no output, disconnected`);
                paneCacheRef.current.clear();
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

            // Sequential — limits concurrent wezterm processes to 1.
            const agents = [];
            for (const pane of claudePanes) {
                const activityKey = paneActivityKey(pane);
                const cached = paneCacheRef.current.get(pane.pane_id);

                let status;
                if (cached && cached.activityKey === activityKey) {
                    status = cached.status;
                    log.debug(`Pane ${pane.pane_id} cached status: ${status}`);
                } else {
                    const text = await weztermExec(
                        ['cli', 'get-text', '--pane-id', String(pane.pane_id), '--start-line', '-20']
                    );
                    status = detectStatus(text);
                    paneCacheRef.current.set(pane.pane_id, { activityKey, status });
                    log.debug(`Pane ${pane.pane_id} fresh status: ${status}`);
                }

                let projectName = 'unknown';
                const titleName = (pane.title || '').replace(/^[⠀-⣿✳]\s*/, '');
                if (titleName && titleName !== 'Claude Code') {
                    projectName = titleName;
                } else if (pane.cwd) {
                    const cleaned = pane.cwd.replace(/^file:\/\/[^/]*/, '').replace(/\\/g, '/');
                    try {
                        const segments = decodeURIComponent(cleaned).split('/').filter(Boolean);
                        projectName = segments[segments.length - 1] || 'unknown';
                    } catch {
                        const segments = cleaned.split('/').filter(Boolean);
                        projectName = segments[segments.length - 1] || 'unknown';
                    }
                }

                agents.push({ paneId: pane.pane_id, agentType: 'claude', status, cwd: pane.cwd || '', title: pane.title || '', projectName });
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
