import { useState, useEffect, useRef } from 'react';
import { shellExec } from 'zebar';
import { log } from './logger.js';

// Resolve the wezterm binary path once to avoid PATH traversal on every call.
let _weztermBinPromise = null;
function getWeztermBin() {
    if (!_weztermBinPromise) {
        _weztermBinPromise = shellExec('cmd', ['/c', 'where wezterm'])
            .then(r => {
                const bin = r.code === 0 ? r.stdout?.trim().split('\n')[0].trim() : null;
                log.info('Resolved wezterm binary', { path: bin ?? 'wezterm (fallback)' });
                return bin ?? 'wezterm';
            })
            .catch(() => 'wezterm');
    }
    return _weztermBinPromise;
}

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

async function weztermExec(args, env = null) {
    const bin = await getWeztermBin();
    const label = `wezterm ${args.slice(0, 3).join(' ')}`;
    try {
        const opts = env ? { env } : {};
        const result = await shellExec(bin, args, opts);
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
        log.error(`${label} threw`, { message: e?.message ?? String(e) });
        return null;
    }
}

async function discoverSocket() {
    log.info('Discovering WezTerm socket');
    try {
        const result = await shellExec('node', ['-e',
            `const fs=require('fs'),path=require('path');` +
            `const dir=path.join(process.env.USERPROFILE,'.local','share','wezterm');` +
            `try{const files=fs.readdirSync(dir).filter(f=>f.startsWith('gui-sock-'));` +
            `if(!files.length)process.exit(1);` +
            `const s=files.map(f=>({f,t:fs.statSync(path.join(dir,f)).mtimeMs})).sort((a,b)=>b.t-a.t);` +
            `process.stdout.write(path.join(dir,s[0].f));}catch(e){process.exit(1);}`
        ]);

        if (result.code !== 0) {
            log.warn('Socket discovery exited non-zero', { code: result.code });
            return null;
        }
        const sock = result.stdout?.trim() || null;
        log.info('Socket discovery result', { sock });
        return sock;
    } catch (e) {
        log.error('Socket discovery threw', { message: e?.message ?? String(e) });
        return null;
    }
}

export function useAgentDeck(pollInterval = 2000) {
    const [state, setState] = useState({
        agents: [],
        counts: { working: 0, waiting: 0, idle: 0, inactive: 0 },
        connected: false,
    });
    const socketRef = useRef(null);
    const pollCountRef = useRef(0);

    useEffect(() => {
        async function poll() {
            const n = ++pollCountRef.current;
            log.debug(`Poll #${n} start`);

            // If we have a known-good socket, use it directly.
            // Otherwise try without env first; if that fails, discover and cache the socket.
            const env = socketRef.current ? { WEZTERM_UNIX_SOCKET: socketRef.current } : null;
            let listOutput = await weztermExec(['cli', 'list', '--format', 'json'], env);

            if (!listOutput) {
                if (socketRef.current) {
                    // Cached socket went stale — clear and re-discover
                    log.info(`Poll #${n}: cached socket stale, re-discovering`);
                    socketRef.current = null;
                }
                socketRef.current = await discoverSocket();
                if (socketRef.current) {
                    listOutput = await weztermExec(
                        ['cli', 'list', '--format', 'json'],
                        { WEZTERM_UNIX_SOCKET: socketRef.current }
                    );
                } else {
                    log.warn(`Poll #${n}: no socket found, giving up`);
                }
            }

            if (!listOutput) {
                socketRef.current = null;
                log.warn(`Poll #${n}: no output from wezterm cli list, setting disconnected`);
                setState({ agents: [], counts: { working: 0, waiting: 0, idle: 0, inactive: 0 }, connected: false });
                return;
            }

            let panes;
            try {
                panes = JSON.parse(listOutput);
                log.debug(`Poll #${n}: parsed ${panes.length} panes`);
            } catch (e) {
                log.error(`Poll #${n}: JSON parse failed`, { message: e?.message, raw: listOutput.slice(0, 200) });
                return;
            }

            const claudePanes = panes.filter(p =>
                p.title && (/claude/i.test(p.title) || /^[\u2800-\u28FF\u2733]\s/.test(p.title))
            );
            log.debug(`Poll #${n}: ${claudePanes.length} Claude pane(s) found`, claudePanes.map(p => ({ id: p.pane_id, title: p.title })));

            const agents = await Promise.all(claudePanes.map(async pane => {
                const text = await weztermExec(
                    ['cli', 'get-text', '--pane-id', String(pane.pane_id), '--start-line', '-20'],
                    env
                );
                const status = detectStatus(text);
                log.debug(`Pane ${pane.pane_id} status: ${status}`);

                let projectName = 'unknown';
                const titleName = (pane.title || '').replace(/^[\u2800-\u28FF\u2733]\s*/, '');
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

                return { paneId: pane.pane_id, agentType: 'claude', status, cwd: pane.cwd || '', title: pane.title || '', projectName };
            }));

            const counts = { working: 0, waiting: 0, idle: 0, inactive: 0 };
            for (const agent of agents) {
                if (counts[agent.status] !== undefined) counts[agent.status]++;
            }

            log.debug(`Poll #${n}: done`, { counts, agents: agents.length });
            setState({ agents, counts, connected: true });
        }

        log.info('useAgentDeck mount', { pollInterval });
        poll();
        const interval = setInterval(poll, pollInterval);
        return () => {
            log.info('useAgentDeck unmount');
            clearInterval(interval);
        };
    }, [pollInterval]);

    function activatePane(paneId) {
        log.info('activatePane', { paneId, socket: socketRef.current });
        const env = socketRef.current ? { WEZTERM_UNIX_SOCKET: socketRef.current } : null;
        return weztermExec(['cli', 'activate-pane', '--pane-id', String(paneId)], env);
    }

    return { ...state, activatePane };
}
