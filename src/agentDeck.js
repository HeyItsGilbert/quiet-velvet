import { useState, useEffect, useRef } from 'react';
import config from './config.js';

const BASE_URL = `http://127.0.0.1:${config.agentDeckPort || 19876}`;

export function useAgentDeck(pollInterval = 2000) {
    const [state, setState] = useState({
        agents: [],
        counts: { working: 0, waiting: 0, idle: 0, inactive: 0 },
        connected: false,
    });
    const intervalRef = useRef(null);

    useEffect(() => {
        async function fetchStatus() {
            try {
                const res = await fetch(`${BASE_URL}/status`);
                if (!res.ok) throw new Error(res.statusText);
                const data = await res.json();

                setState({
                    agents: data.agents || [],
                    counts: data.counts || { working: 0, waiting: 0, idle: 0, inactive: 0 },
                    connected: true,
                });
            } catch {
                setState(prev => ({ ...prev, connected: false }));
            }
        }

        fetchStatus();
        intervalRef.current = setInterval(fetchStatus, pollInterval);
        return () => clearInterval(intervalRef.current);
    }, [pollInterval]);

    return state;
}
