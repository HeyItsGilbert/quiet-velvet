/**
 * Agent Deck logger — console only.
 */

const MAX_BUFFER = 300;

let buffer = [];

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
}

export const log = {
    debug: (msg, data) => addEntry('DEBUG', msg, data),
    info:  (msg, data) => addEntry('INFO',  msg, data),
    warn:  (msg, data) => addEntry('WARN',  msg, data),
    error: (msg, data) => addEntry('ERROR', msg, data),
};
