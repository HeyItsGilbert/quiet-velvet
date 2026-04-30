import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as zebar from 'zebar';
import GoogleSearch from "./components/GoogleSearch.jsx";
import Settings from "./components/Settings.jsx";
import Shortcut from "./components/Shortcut";
import AgentDeck from "./components/AgentDeck.jsx";
import config from "./config.js";
import moment from "moment";

window.onerror = (msg, src, line, col, err) => {
    console.error('[Zebar] Uncaught error:', msg, `\n  at ${src}:${line}:${col}`, err?.stack || '');
};
window.onunhandledrejection = (e) => {
    console.error('[Zebar] Unhandled rejection:', e.reason?.message || e.reason, e.reason?.stack || '');
};

const providers = zebar.createProviderGroup({
    keyboard: { type: 'keyboard' },
    glazewm: { type: 'glazewm' },
    cpu: { type: 'cpu' },
    date: { type: 'date', formatting: 'EEE d MMM t' },
    battery: { type: 'battery' },
    memory: { type: 'memory' },
    weather: { type: 'weather' },
    host: { type: 'host' }
});

class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error, info) {
        console.error('[Zebar] React render error:', error.message, error.stack, info.componentStack);
    }
    render() {
        if (this.state.error) {
            return <div style={{color:'#f87171',fontSize:'11px',padding:'8px'}}>
                Widget error — check console
            </div>;
        }
        return this.props.children;
    }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App/></ErrorBoundary>);

function App() {
    const [output, setOutput] = useState(providers.outputMap);
    const [showGoogleSearch, setShowGoogleSearch] = useState(true);
    const [showShortcuts, setShowShortcuts] = useState(true);
    const [showAgentDeck, setShowAgentDeck] = useState(true);
    const [dateFormat, setDateFormat] = useState('HH:mm');

    useEffect(() => {
        providers.onOutput(() => setOutput(providers.outputMap));
    }, []);

    function getBatteryIcon(batteryOutput) {
        if (batteryOutput.chargePercent > 90)
            return <i className="nf nf-fa-battery_4"></i>;
        if (batteryOutput.chargePercent > 70)
            return <i className="nf nf-fa-battery_3"></i>;
        if (batteryOutput.chargePercent > 40)
            return <i className="nf nf-fa-battery_2"></i>;
        if (batteryOutput.chargePercent > 20)
            return <i className="nf nf-fa-battery_1"></i>;
        return <i className="nf nf-fa-battery_0"></i>;
    }

    function getWeatherIcon(weatherOutput) {
        switch (weatherOutput.status) {
            case 'clear_day':
                return <i className="nf nf-weather-day_sunny"></i>;
            case 'clear_night':
                return <i className="nf nf-weather-night_clear"></i>;
            case 'cloudy_day':
                return <i className="nf nf-weather-day_cloudy"></i>;
            case 'cloudy_night':
                return <i className="nf nf-weather-night_alt_cloudy"></i>;
            case 'light_rain_day':
                return <i className="nf nf-weather-day_sprinkle"></i>;
            case 'light_rain_night':
                return <i className="nf nf-weather-night_alt_sprinkle"></i>;
            case 'heavy_rain_day':
                return <i className="nf nf-weather-day_rain"></i>;
            case 'heavy_rain_night':
                return <i className="nf nf-weather-night_alt_rain"></i>;
            case 'snow_day':
                return <i className="nf nf-weather-day_snow"></i>;
            case 'snow_night':
                return <i className="nf nf-weather-night_alt_snow"></i>;
            case 'thunder_day':
                return <i className="nf nf-weather-day_lightning"></i>;
            case 'thunder_night':
                return <i className="nf nf-weather-night_alt_lightning"></i>;
        }
    }

    return (
        <div className="app">
            <div className="left">
                <div className="box">
                    <div className="logo">
                        <i className="nf nf-custom-windows"></i>
                        {output.host?.hostname}
                    </div>
                    {output.glazewm && (
                        <div className="workspaces">
                            {output.glazewm.currentWorkspaces.map(workspace => (
                                <button
                                    className={`workspace ${workspace.hasFocus && 'focused'} ${workspace.isDisplayed && 'displayed'}`}
                                    onClick={() =>
                                        output.glazewm.runCommand(
                                            `focus --workspace ${workspace.name}`,
                                        )
                                    }
                                    key={workspace.name}
                                >
                                    {workspace.displayName ?? workspace.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {showShortcuts && output.glazewm ? <div className="workspaces">
                    <Shortcut commandRunner={output.glazewm.runCommand}
                              commands={[
                                  'focus --workspace 3',
                                  `shell-exec ${config.arcBrowserPath}`
                              ]}
                              iconClass="nf-md-web" name="Arc Browser"
                    />
                    <Shortcut commandRunner={output.glazewm.runCommand}
                              commands={[
                                  'focus --workspace 2',
                                  `shell-exec ${config.powershellPath}`
                              ]}
                              iconClass="nf-cod-terminal_powershell" name="Powershell"
                    />
                </div> : null}
            </div>

            <div className="center">
                <div className="box">
                    {showAgentDeck && output.glazewm ? <AgentDeck commandRunner={output.glazewm.runCommand} glazewm={output.glazewm}/> : null}
                    <i className="nf nf-md-calendar_month"></i>
                    <button className="clean-button" onMouseEnter={() => {
                        setDateFormat('ddd DD MMM HH:mm')
                    }} onMouseLeave={() => {
                        setDateFormat('HH:mm')
                    }}>
                        {moment(output.date?.now).format(dateFormat)}
                    </button>
                </div>
            </div>

            <div className="right">
                {showGoogleSearch && output.glazewm ? <GoogleSearch
                    commandRunner={output.glazewm.runCommand} explorerPath={config.explorerPath}/> : null}
                <div className="box">
                    {output.glazewm && (
                        <>
                            {output.glazewm.bindingModes.map(bindingMode => (
                                <button
                                    className="binding-mode"
                                    key={bindingMode.name}
                                >
                                    {bindingMode.displayName ?? bindingMode.name}
                                </button>
                            ))}

                            <button
                                className={`tiling-direction nf ${output.glazewm.tilingDirection === 'horizontal' ? 'nf-md-swap_horizontal' : 'nf-md-swap_vertical'}`}
                                onClick={() =>
                                    output.glazewm.runCommand('toggle-tiling-direction')
                                }
                            ></button>
                        </>
                    )}
                    {<Settings widgetObj={[
                        { name: 'Google Search', changeState: setShowGoogleSearch },
                        { name: 'Shortcuts', changeState: setShowShortcuts },
                        { name: 'Agent Deck', changeState: setShowAgentDeck }
                    ]}/>}

                    {output.memory && (
                        <button className="memory clean-button" onClick={
                            () => output.glazewm.runCommand('shell-exec taskmgr')
                        }>
                            <i className="nf nf-fae-chip"></i>
                            {Math.round(output.memory.usage)}%
                        </button>
                    )}

                    {output.cpu && (
                        <button className="cpu clean-button" onClick={
                            () => output.glazewm.runCommand('shell-exec taskmgr')
                        }>
                            <i className="nf nf-oct-cpu"></i>

                            {/* Change the text color if the CPU usage is high. */}
                            <span
                                className={output.cpu.usage > 85 ? 'high-usage' : ''}
                            >
                    {Math.round(output.cpu.usage)}%
                  </span>
                        </button>
                    )}

                    {output.battery && (
                        <div className="battery">
                            {/* Show icon for whether battery is charging. */}
                            {output.battery.isCharging && (
                                <i className="nf nf-md-power_plug charging-icon"></i>
                            )}
                            {getBatteryIcon(output.battery)}
                            {Math.round(output.battery.chargePercent)}%
                        </div>
                    )}

                    {output.weather && (
                        <div className="weather">
                            {getWeatherIcon(output.weather)}
                            {Math.round(output.weather.fahrenheitTemp)}°F
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
