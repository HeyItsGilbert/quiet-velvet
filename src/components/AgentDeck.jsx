import React, { useState } from 'react';
import { useAgentDeck } from '../agentDeck.js';

const STATUS_COLORS = {
    working: '#4ade80',
    waiting: '#facc15',
    idle: '#60a5fa',
    inactive: '#6b7280',
};

const STATUS_ICONS = {
    working: 'nf-md-hammer_wrench',
    waiting: 'nf-md-hand_back_right',
    idle: 'nf-md-coffee',
    inactive: 'nf-md-ghost_off',
};

function findWeztermContainer(workspaces) {
    for (const ws of workspaces) {
        const stack = [...(ws.children || [])];
        while (stack.length) {
            const node = stack.pop();
            if (node.processName && /wezterm/i.test(node.processName)) {
                return { containerId: node.id, workspace: ws.name };
            }
            if (node.children) stack.push(...node.children);
        }
    }
    return null;
}

const AgentDeck = ({ commandRunner, glazewm }) => {
    const { agents, counts, connected, activatePane } = useAgentDeck(1000);
    const [expanded, setExpanded] = useState(false);

    const totalAgents = agents.length;
    const activeStatuses = ['working', 'waiting', 'idle', 'inactive'].filter(s => counts[s] > 0);

    function focusPane(paneId) {
        const wt = glazewm ? findWeztermContainer(glazewm.allWorkspaces || []) : null;
        if (wt && commandRunner) {
            commandRunner(`focus --workspace ${wt.workspace}`);
        }
        activatePane(paneId);
    }

    return (
        <div
            className="agent-deck"
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={() => setExpanded(false)}
        >
            <div className={`agent-deck-compact ${!connected ? 'agent-deck-disconnected' : ''}`}>
                <i className="nf nf-md-robot"></i>
                {connected && totalAgents > 0 ? (
                    expanded ? (
                        agents.map(agent => (
                            <button
                                key={agent.paneId}
                                className="agent-deck-agent clean-button"
                                onClick={() => focusPane(agent.paneId)}
                                title={`Focus pane ${agent.paneId}`}
                            >
                                <i
                                    className={`nf ${STATUS_ICONS[agent.status] || STATUS_ICONS.inactive} agent-deck-status-icon`}
                                    style={{ color: STATUS_COLORS[agent.status] || STATUS_COLORS.inactive }}
                                />
                                <span className="agent-deck-project">{agent.projectName}</span>
                            </button>
                        ))
                    ) : (
                        activeStatuses.map(status => (
                            <span key={status} className="agent-deck-status-group">
                                <i
                                    className={`nf ${STATUS_ICONS[status]} agent-deck-status-icon`}
                                    style={{ color: STATUS_COLORS[status] }}
                                />
                                <span className="agent-deck-count">{counts[status]}</span>
                            </span>
                        ))
                    )
                ) : connected ? (
                    <span className="agent-deck-count agent-deck-none">0</span>
                ) : (
                    <span className="agent-deck-count agent-deck-none">--</span>
                )}
            </div>
        </div>
    );
};

export default AgentDeck;
