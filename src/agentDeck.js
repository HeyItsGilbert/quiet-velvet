import { useState, useEffect, useRef } from 'react';
import config from './config.js';

export const BASE_URL = `http://127.0.0.1:${config.agentDeckPort || 19876}`;

export function useAgentDeck(pollInterval = 2000, commandRunner = null) {
    const [state, setState] = useState({
        agents: [],
        counts: { working: 0, waiting: 0, idle: 0, inactive: 0 },
        connected: false,
    });
    const intervalRef = useRef(null);
    const startAttemptedRef = useRef(false);

    useEffect(() => {
        async function fetchStatus() {
            try {
                const res = await fetch(`${BASE_URL}/status`);
                if (!res.ok) throw new Error(res.statusText);
                const data = await res.json();

                startAttemptedRef.current = false;
                setState({
                    agents: data.agents || [],
                    counts: data.counts || { working: 0, waiting: 0, idle: 0, inactive: 0 },
                    connected: true,
                });
            } catch {
                if (!startAttemptedRef.current && commandRunner) {
                    startAttemptedRef.current = true;
                    const port = config.agentDeckPort || 19876;
                    const script = `%userprofile%\\.glzr\\zebar\\quiet-velvet\\scripts\\agent-deck-server.js`;
                    commandRunner(`shell-exec cmd /c start /b node "${script}" ${port}`);
                    console.log('[AgentDeck] Server not running, launched via shell-exec');
                }
                setState({
                    agents: [],
                    counts: { working: 0, waiting: 0, idle: 0, inactive: 0 },
                    connected: false,
                });
            }
        }

        fetchStatus();
        intervalRef.current = setInterval(fetchStatus, pollInterval);
        return () => clearInterval(intervalRef.current);
    }, [pollInterval, commandRunner]);

    return state;
}
