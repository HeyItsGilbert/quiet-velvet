#!/usr/bin/env node
// Agent Deck Bridge Server
// Detects Claude Code agents directly via `wezterm cli` and serves status over HTTP.
// No Lua bridge needed — this server does its own detection.
// Usage: node scripts/agent-deck-server.js [port]

const http = require('http');
const { execSync } = require('child_process');

const PORT = parseInt(process.argv[2] || '19876', 10);
const POLL_INTERVAL = 2000;

// Patterns to detect status from terminal content (last ~20 lines)
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

const IDLE_PATTERNS = [
    /^>\s*$/m,          // bare prompt
    /\$ $/m,            // shell prompt at end
    /what would you like/i,
    /how can i help/i,
];

let cachedState = {
    agents: [],
    counts: { working: 0, waiting: 0, idle: 0, inactive: 0 },
    timestamp: 0,
};

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    } catch {
        return null;
    }
}

function detectStatus(text) {
    if (!text) return 'inactive';
    // Check last ~20 lines
    const lines = text.split('\n').slice(-20).join('\n');

    // Priority: waiting > working > idle
    for (const pat of WAITING_PATTERNS) {
        if (pat.test(lines)) return 'waiting';
    }
    for (const pat of WORKING_PATTERNS) {
        if (pat.test(lines)) return 'working';
    }
    for (const pat of IDLE_PATTERNS) {
        if (pat.test(lines)) return 'idle';
    }
    return 'idle';
}

function pollAgents() {
    const listOutput = run('wezterm cli list --format json');
    if (!listOutput) {
        cachedState = {
            agents: [],
            counts: { working: 0, waiting: 0, idle: 0, inactive: 0 },
            timestamp: Date.now(),
        };
        return;
    }

    let panes;
    try {
        panes = JSON.parse(listOutput);
    } catch {
        return;
    }

    // Find Claude Code panes by title
    const claudePanes = panes.filter(p =>
        p.title && /claude/i.test(p.title)
    );

    const agents = claudePanes.map(pane => {
        // Get terminal content for status detection
        const text = run(`wezterm cli get-text --pane-id ${pane.pane_id} --start-line -20`);
        const status = detectStatus(text);

        // Extract project name from cwd
        let projectName = 'unknown';
        if (pane.cwd) {
            const cleaned = pane.cwd
                .replace(/^file:\/\/[^/]*/, '')
                .replace(/\\/g, '/');
            try {
                const decoded = decodeURIComponent(cleaned);
                const segments = decoded.split('/').filter(Boolean);
                projectName = segments[segments.length - 1] || 'unknown';
            } catch {
                const segments = cleaned.split('/').filter(Boolean);
                projectName = segments[segments.length - 1] || 'unknown';
            }
        }

        return {
            paneId: pane.pane_id,
            agentType: 'claude',
            status,
            cwd: pane.cwd || '',
            title: pane.title || '',
            projectName,
        };
    });

    const counts = { working: 0, waiting: 0, idle: 0, inactive: 0 };
    for (const agent of agents) {
        if (counts[agent.status] !== undefined) {
            counts[agent.status]++;
        }
    }

    cachedState = { agents, counts, timestamp: Date.now() };
}

// Poll on startup and every POLL_INTERVAL ms
pollAgents();
setInterval(pollAgents, POLL_INTERVAL);

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/status' || req.url === '/') {
        res.writeHead(200);
        res.end(JSON.stringify(cachedState));
    } else if (req.url.startsWith('/focus/') && req.method === 'POST') {
        const paneId = req.url.split('/focus/')[1];
        run(`wezterm cli activate-pane --pane-id ${paneId}`);
        res.writeHead(200);
        res.end('{"ok":true}');
    } else {
        res.writeHead(404);
        res.end('{"error":"not found"}');
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Agent Deck server listening on http://127.0.0.1:${PORT}`);
    console.log(`Polling WezTerm CLI every ${POLL_INTERVAL}ms`);
});
