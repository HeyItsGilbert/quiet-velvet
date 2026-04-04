/**
 * Agent Deck logger — writes to console and flushes to agent-deck.log
 * Log file: %USERPROFILE%\.glzr\zebar\quiet-velvet\agent-deck.log
 */
import { shellExec } from 'zebar';

const FLUSH_INTERVAL_MS = 3000;
const MAX_BUFFER = 300;

let buffer = [];
let dirty = false;

function timestamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

function formatEntry(level, message, data) {
    const dataStr = data !== undefined
        ? ' ' + (typeof data === 'string' ? data : JSON.stringify(data))
        : '';
    return `${timestamp()} [${level.padEnd(5)}] ${message}${dataStr}`;
}

function addEntry(level, message, data) {
    const entry = formatEntry(level, message, data);

    if (level === 'ERROR') console.error('[AgentDeck]', entry);
    else if (level === 'WARN') console.warn('[AgentDeck]', entry);
    else console.log('[AgentDeck]', entry);

    buffer.push(entry);
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
    dirty = true;
}

async function flush() {
    if (!dirty || buffer.length === 0) return;

    const lines = buffer.splice(0, buffer.length);
    dirty = buffer.length > 0;
    const content = lines.join('\n') + '\n';

    try {
        await shellExec('node', ['-e',
            `const fs=require('fs'),path=require('path');` +
            `const p=path.join(process.env.USERPROFILE,'.glzr','zebar','quiet-velvet','agent-deck.log');` +
            `fs.appendFileSync(p,${JSON.stringify(content)});`
        ]);
    } catch (e) {
        console.error('[AgentDeck] log flush failed:', e);
    }
}

setInterval(flush, FLUSH_INTERVAL_MS);

export const log = {
    debug: (msg, data) => addEntry('DEBUG', msg, data),
    info:  (msg, data) => addEntry('INFO',  msg, data),
    warn:  (msg, data) => addEntry('WARN',  msg, data),
    error: (msg, data) => addEntry('ERROR', msg, data),
};
