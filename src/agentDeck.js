import { useState, useEffect, useRef } from 'react';
import { shellExec, currentWidget } from 'zebar';
import { log } from './logger.js';

// Derive USERPROFILE from the widget's html path (e.g. C:\Users\<user>\.glzr\...)
const htmlPath = currentWidget().htmlPath;
const userProfile = htmlPath.match(/^([A-Z]:\\Users\\[^\\]+)/i)?.[1] ?? '';
// https://github.com/wezterm/wezterm/issues/4456#issuecomment-2286974918
const WEZTERM_CWD = `${userProfile}\\.local\\share\\wezterm`;


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
        const result = await shellExec('wezterm', args, { cwd: WEZTERM_CWD });
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

export function useAgentDeck(pollInterval = 2000) {
    const [state, setState] = useState({
        agents: [],
        counts: { working: 0, waiting: 0, idle: 0, inactive: 0 },
        connected: false,
    });
    const pollCountRef = useRef(0);

    useEffect(() => {
        async function poll() {
            const n = ++pollCountRef.current;
            log.debug(`Poll #${n} start`);

            const listOutput = await weztermExec(['cli', 'list', '--format', 'json']);

            if (!listOutput) {
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
                    ['cli', 'get-text', '--pane-id', String(pane.pane_id), '--start-line', '-20']
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
        log.info('activatePane', { paneId });
        return weztermExec(['cli', 'activate-pane', '--pane-id', String(paneId)]);
    }

    return { ...state, activatePane };
}
