/**
 * Main Worker - Clean Implementation
 * Koordiniert Lighter Tracker und bietet API/Frontend
 */

import { LighterTracker } from './lighter-new';

export { LighterTracker };

export interface Env {
  LIGHTER_TRACKER: DurableObjectNamespace;
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors Headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    //=====================================
    // WebSocket Routing
    //=====================================

    if (url.pathname === '/ws') {
      const id = env.LIGHTER_TRACKER.idFromName('lighter-tracker');
      const tracker = env.LIGHTER_TRACKER.get(id);
      return tracker.fetch(request);
    }

    //=====================================
    // API Endpoints
    //=====================================

    // GET /api/stats - Tracking Statistics
    if (url.pathname === '/api/stats') {
      try {
        const id = env.LIGHTER_TRACKER.idFromName('lighter-tracker');
        const tracker = env.LIGHTER_TRACKER.get(id);

        // Forward request to tracker
        const statsResponse = await tracker.fetch(new Request('http://internal/stats'));
        const stats = await statsResponse.json();

        return new Response(JSON.stringify(stats), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to get stats' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/markets - All Markets
    if (url.pathname === '/api/markets') {
      try {
        const result = await env.DB.prepare(
          `SELECT * FROM lighter_markets WHERE active = 1 ORDER BY symbol`
        ).all();

        return new Response(JSON.stringify({
          markets: result.results || [],
          count: result.results?.length || 0
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Database error' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/snapshots?symbol=ETH&limit=100
    if (url.pathname === '/api/snapshots') {
      try {
        const symbol = url.searchParams.get('symbol');
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        let query = 'SELECT * FROM lighter_snapshots';
        const bindings: any[] = [];

        if (symbol) {
          query += ' WHERE symbol = ?';
          bindings.push(symbol);
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        bindings.push(limit, offset);

        const result = await env.DB.prepare(query).bind(...bindings).all();

        return new Response(JSON.stringify({
          snapshots: result.results || [],
          count: result.results?.length || 0,
          pagination: { limit, offset }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Database error' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/minutes?symbol=ETH&limit=60
    if (url.pathname === '/api/minutes') {
      try {
        const symbol = url.searchParams.get('symbol');
        const limit = parseInt(url.searchParams.get('limit') || '60');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const from = url.searchParams.get('from'); // timestamp
        const to = url.searchParams.get('to'); // timestamp

        let query = 'SELECT * FROM lighter_minutes';
        const bindings: any[] = [];
        const conditions: string[] = [];

        if (symbol) {
          conditions.push('symbol = ?');
          bindings.push(symbol);
        }

        if (from) {
          conditions.push('timestamp >= ?');
          bindings.push(parseInt(from));
        }

        if (to) {
          conditions.push('timestamp <= ?');
          bindings.push(parseInt(to));
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        bindings.push(limit, offset);

        const result = await env.DB.prepare(query).bind(...bindings).all();

        return new Response(JSON.stringify({
          minutes: result.results || [],
          count: result.results?.length || 0,
          pagination: { limit, offset }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Database error' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/overview - Data Overview
    if (url.pathname === '/api/overview') {
      try {
        const symbolStats = await env.DB.prepare(`
          SELECT symbol,
                 COUNT(*) as total_minutes,
                 MIN(timestamp) as first_minute,
                 MAX(timestamp) as last_minute,
                 AVG(avg_bid) as overall_avg_bid,
                 AVG(avg_ask) as overall_avg_ask,
                 SUM(tick_count) as total_ticks
          FROM lighter_minutes
          GROUP BY symbol
          ORDER BY symbol
        `).all();

        return new Response(JSON.stringify({
          symbols: symbolStats.results || [],
          count: symbolStats.results?.length || 0
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Database error' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    //=====================================
    // Frontend
    //=====================================

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(FRONTEND_HTML, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};

//=====================================
// Frontend HTML
//=====================================

const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lighter Orderbook Tracker</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #0a0b0d;
      color: #00ff88;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      font-size: 32px;
      margin-bottom: 10px;
      text-shadow: 0 0 10px #00ff88;
    }
    .subtitle {
      color: #8b92a8;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .control-panel {
      background: #1a1c26;
      border: 1px solid #00ff88;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .status {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 20px;
      margin-bottom: 15px;
      font-weight: bold;
    }
    .status.running { background: rgba(0, 255, 136, 0.2); color: #00ff88; }
    .status.stopped { background: rgba(255, 51, 102, 0.2); color: #ff3366; }
    .buttons {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    button {
      padding: 12px 24px;
      border: none;
      border-radius: 6px;
      font-family: inherit;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .btn-start {
      background: #00ff88;
      color: #0a0b0d;
    }
    .btn-start:hover:not(:disabled) {
      background: #00cc6f;
      transform: translateY(-1px);
    }
    .btn-stop {
      background: #ff3366;
      color: white;
    }
    .btn-stop:hover:not(:disabled) {
      background: #cc2952;
      transform: translateY(-1px);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 10px;
      margin-bottom: 20px;
    }
    .stat-item {
      background: #13141a;
      padding: 15px;
      border-radius: 6px;
      border-left: 3px solid #00ff88;
    }
    .stat-label {
      color: #8b92a8;
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
    }
    .log-panel {
      background: #13141a;
      border: 1px solid #2a2d3a;
      border-radius: 6px;
      padding: 15px;
      max-height: 300px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.6;
    }
    .log-entry {
      margin-bottom: 5px;
    }
    .log-time {
      color: #8b92a8;
      margin-right: 10px;
    }
    .loading {
      text-align: center;
      padding: 40px;
      color: #8b92a8;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>⚡ LIGHTER ORDERBOOK TRACKER</h1>
    <p class="subtitle">Streaming Aggregation • 15s Windows • Memory Efficient</p>

    <div class="control-panel">
      <div class="status" id="status">Connecting...</div>

      <div class="buttons">
        <button class="btn-start" id="startBtn" disabled>▶ START TRACKING</button>
        <button class="btn-stop" id="stopBtn" disabled>⏸ STOP TRACKING</button>
      </div>

      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">Markets</div>
          <div class="stat-value" id="marketsCount">-</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Messages</div>
          <div class="stat-value" id="messagesCount">-</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Snapshots in DB</div>
          <div class="stat-value" id="snapshotsCount">-</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Minutes in DB</div>
          <div class="stat-value" id="minutesCount">-</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Current Window</div>
          <div class="stat-value" id="windowSymbols">-</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Last Message</div>
          <div class="stat-value" id="lastMessage">-</div>
        </div>
      </div>
    </div>

    <div class="log-panel" id="logPanel">
      <div class="log-entry"><span class="log-time">[00:00:00]</span> Waiting for connection...</div>
    </div>
  </div>

  <script>
    const WS_URL = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    let ws = null;
    let reconnectTimeout = null;

    // Connect to WebSocket
    function connect() {
      log('Connecting to WebSocket...');
      ws = new WebSocket(WS_URL + window.location.host + '/ws');

      ws.onopen = () => {
        log('✅ Connected');
        ws.send(JSON.stringify({ type: 'get_stats' }));
        startStatsInterval();
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      };

      ws.onclose = () => {
        log('❌ Disconnected');
        updateStatus(false, false);
        reconnectTimeout = setTimeout(connect, 5000);
      };

      ws.onerror = (error) => {
        log('❌ WebSocket error');
      };
    }

    // Handle messages
    function handleMessage(msg) {
      if (msg.type === 'stats') {
        updateStats(msg.data);
      } else if (msg.type === 'control') {
        log(msg.data.message);
        ws.send(JSON.stringify({ type: 'get_stats' }));
      } else if (msg.type === 'status') {
        log(msg.data.isTracking ? '▶️ Tracking started' : '⏸️ Tracking stopped');
        updateStatus(msg.data.isTracking, true);
      }
    }

    // Update stats
    function updateStats(data) {
      updateStatus(data.isTracking, data.connected);

      document.getElementById('marketsCount').textContent = data.markets || 0;
      document.getElementById('messagesCount').textContent = (data.messagesReceived || 0).toLocaleString();
      document.getElementById('snapshotsCount').textContent = data.database?.snapshots || 0;
      document.getElementById('minutesCount').textContent = data.database?.minutes || 0;
      document.getElementById('windowSymbols').textContent = data.aggregator?.currentSymbols || 0;

      if (data.lastMessageAt) {
        const ago = Math.floor((Date.now() - data.lastMessageAt) / 1000);
        document.getElementById('lastMessage').textContent = ago + 's ago';
      }
    }

    // Update status
    function updateStatus(isTracking, isConnected) {
      const statusEl = document.getElementById('status');
      const startBtn = document.getElementById('startBtn');
      const stopBtn = document.getElementById('stopBtn');

      if (isTracking) {
        statusEl.textContent = '🟢 TRACKING';
        statusEl.className = 'status running';
        startBtn.disabled = true;
        stopBtn.disabled = false;
      } else {
        statusEl.textContent = isConnected ? '🔴 STOPPED' : '⚠️ DISCONNECTED';
        statusEl.className = 'status stopped';
        startBtn.disabled = !isConnected;
        stopBtn.disabled = true;
      }
    }

    // Button handlers
    document.getElementById('startBtn').addEventListener('click', () => {
      log('▶️ Starting tracking...');
      ws.send(JSON.stringify({ type: 'start_tracking' }));
    });

    document.getElementById('stopBtn').addEventListener('click', () => {
      log('⏸️ Stopping tracking...');
      ws.send(JSON.stringify({ type: 'stop_tracking' }));
    });

    // Logging
    function log(message) {
      const logPanel = document.getElementById('logPanel');
      const time = new Date().toLocaleTimeString();
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = '<span class="log-time">[' + time + ']</span> ' + message;
      logPanel.insertBefore(entry, logPanel.firstChild);

      // Keep only last 50 entries
      while (logPanel.children.length > 50) {
        logPanel.removeChild(logPanel.lastChild);
      }
    }

    // Auto-refresh stats
    let statsInterval = null;
    function startStatsInterval() {
      if (statsInterval) clearInterval(statsInterval);
      statsInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'get_stats' }));
        }
      }, 5000);
    }

    // Initialize
    connect();
  </script>
</body>
</html>`;
