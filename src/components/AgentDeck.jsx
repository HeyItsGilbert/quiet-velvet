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

const STATUS_LABELS = {
    working: 'Working',
    waiting: 'Waiting',
    idle: 'Idle',
    inactive: 'Inactive',
};

const AgentDeck = ({ commandRunner }) => {
    const { agents, counts, connected } = useAgentDeck(2000);
    const [showPanel, setShowPanel] = useState(false);

    const totalAgents = agents.length;
    const activeStatuses = ['working', 'waiting', 'idle', 'inactive'].filter(s => counts[s] > 0);

    function focusPane(paneId) {
        if (commandRunner) {
            commandRunner(`shell-exec wezterm cli activate-pane --pane-id ${paneId}`);
        }
    }

    return (
        <div
            className="agent-deck"
            onMouseEnter={() => setShowPanel(true)}
            onMouseLeave={() => setShowPanel(false)}
        >
            <div className={`agent-deck-compact ${!connected ? 'agent-deck-disconnected' : ''}`}>
                <i className="nf nf-md-robot"></i>
                {connected && totalAgents > 0 ? (
                    activeStatuses.map(status => (
                        <span key={status} className="agent-deck-status-group">
                            <i
                                className={`nf ${STATUS_ICONS[status]} agent-deck-status-icon`}
                                style={{ color: STATUS_COLORS[status] }}
                            />
                            <span className="agent-deck-count">{counts[status]}</span>
                        </span>
                    ))
                ) : connected ? (
                    <span className="agent-deck-count agent-deck-none">0</span>
                ) : (
                    <span className="agent-deck-count agent-deck-none">--</span>
                )}
            </div>

            {showPanel && connected && totalAgents > 0 && (
                <div className="agent-deck-panel">
                    {agents.map(agent => (
                        <button
                            key={agent.paneId}
                            className="agent-deck-row clean-button"
                            onClick={() => focusPane(agent.paneId)}
                            title={`Focus pane ${agent.paneId}`}
                        >
                            <i
                                className={`nf ${STATUS_ICONS[agent.status] || STATUS_ICONS.inactive} agent-deck-status-icon`}
                                style={{ color: STATUS_COLORS[agent.status] || STATUS_COLORS.inactive }}
                            />
                            <span className="agent-deck-project">{agent.projectName}</span>
                            <span
                                className="agent-deck-status-label"
                                style={{ color: STATUS_COLORS[agent.status] || STATUS_COLORS.inactive }}
                            >
                                {STATUS_LABELS[agent.status] || agent.status}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AgentDeck;
