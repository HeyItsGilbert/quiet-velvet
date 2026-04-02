-- =============================================================================
-- Agent Deck Bridge for Zebar
-- =============================================================================
-- Paste this snippet into your wezterm.lua AFTER the agent_deck plugin is loaded.
-- It writes agent state to a JSON file that the Zebar widget reads via the
-- bridge server (scripts/agent-deck-server.js).
--
-- Requirements:
--   - wezterm-agent-deck plugin must be loaded first
--   - The directory ~/.glzr/zebar/ must exist
--
-- Usage:
--   1. Add this code to the end of your wezterm.lua
--   2. Reload WezTerm config (ctrl+shift+r)
--   3. Start the bridge server: node scripts/agent-deck-server.js
-- =============================================================================

local wezterm = require('wezterm')
local io = require('io')
local os = require('os')

local bridge_path = wezterm.home_dir .. '/.glzr/zebar/agent-deck-state.json'

-- Simple Lua table to JSON serializer (no dependencies)
local function is_array(t)
    if type(t) ~= 'table' then return false end
    local count = 0
    for _ in pairs(t) do count = count + 1 end
    if count == 0 then return true end -- empty table = empty array
    for i = 1, count do
        if t[i] == nil then return false end
    end
    return true
end

local function to_json(value)
    if type(value) == 'table' then
        if is_array(value) then
            local parts = {}
            for i = 1, #value do
                table.insert(parts, to_json(value[i]))
            end
            return '[' .. table.concat(parts, ',') .. ']'
        else
            local parts = {}
            for k, v in pairs(value) do
                table.insert(parts, '"' .. tostring(k) .. '":' .. to_json(v))
            end
            return '{' .. table.concat(parts, ',') .. '}'
        end
    elseif type(value) == 'string' then
        return '"' .. value:gsub('\\', '\\\\'):gsub('"', '\\"') .. '"'
    elseif type(value) == 'number' then
        return tostring(value)
    elseif type(value) == 'boolean' then
        return value and 'true' or 'false'
    else
        return 'null'
    end
end

local function write_agent_state()
    local ok, err = pcall(function()
        local all_states = agent_deck.get_all_agent_states()
        local agents = {}

        -- Debug: log what agent_deck returns
        local state_count = 0
        for _ in pairs(all_states) do state_count = state_count + 1 end
        wezterm.log_info('Agent deck bridge: found ' .. state_count .. ' agent(s)')

        for pane_id, state in pairs(all_states) do
            -- Get pane metadata from WezTerm
            local cwd = ''
            local title = ''
            local success, pane = pcall(function()
                return wezterm.mux.get_pane(pane_id)
            end)
            if success and pane then
                cwd = tostring(pane:get_current_working_dir() or '')
                title = pane:get_title() or ''
            end

            table.insert(agents, {
                paneId = pane_id,
                agentType = state.agent_type or 'unknown',
                status = state.status or 'inactive',
                cwd = cwd,
                title = title,
                lastUpdate = state.last_update or 0,
            })
        end

        -- Count by status
        local counts = { working = 0, waiting = 0, idle = 0, inactive = 0 }
        for _, agent in ipairs(agents) do
            local s = agent.status
            if counts[s] ~= nil then
                counts[s] = counts[s] + 1
            end
        end

        local payload = {
            agents = agents,
            counts = counts,
            timestamp = os.time(),
        }

        local file = io.open(bridge_path, 'w')
        if file then
            file:write(to_json(payload))
            file:close()
        end
    end)

    if not ok then
        wezterm.log_warn('Agent deck bridge error: ' .. tostring(err))
    end
end

-- Write state on every status change
wezterm.on('agent_deck.status_changed', function()
    write_agent_state()
end)

wezterm.on('agent_deck.agent_detected', function()
    write_agent_state()
end)

wezterm.on('agent_deck.agent_finished', function()
    write_agent_state()
end)

-- Also poll on a timer as a fallback (every 2 seconds)
wezterm.time.call_after(2, function()
    local function tick()
        write_agent_state()
        wezterm.time.call_after(2, tick)
    end
    tick()
end)
