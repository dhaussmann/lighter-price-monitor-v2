/**
 * Multi-Exchange Orderbook Tracker - Main Coordinator
 * Coordinates between Lighter and Paradex Durable Objects
 */

import { LighterTracker } from './lighter-tracker';
import { ParadexTracker } from './paradex-tracker';

export { LighterTracker, ParadexTracker };

export interface Env {
  LIGHTER_TRACKER: DurableObjectNamespace;
  PARADEX_TRACKER: DurableObjectNamespace;
  CLEANUP_MANAGER: DurableObjectNamespace;
  DB: D1Database;
}

// Cleanup Durable Object - runs periodic cleanup
export class CleanupManager {
  private state: DurableObjectState;
  private env: Env;
  private cleanupInterval: any = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Start cleanup immediately
    this.startCleanup();
  }

  startCleanup() {
    // Clean up old data every 30 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 30 * 60 * 1000);

    // Run immediately on start
    this.cleanupOldData();
  }

  async cleanupOldData() {
    try {
      const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);

      // Delete old orderbook entries
      const orderbookResult = await this.env.DB.prepare(
        `DELETE FROM orderbook_entries WHERE timestamp < ?`
      ).bind(thirtyMinutesAgo).run();

      // Delete old trades
      const tradesResult = await this.env.DB.prepare(
        `DELETE FROM paradex_trades WHERE created_at < ?`
      ).bind(thirtyMinutesAgo).run();

      console.log(`[Cleanup] 🧹 Removed ${orderbookResult.meta.changes || 0} orderbook entries, ${tradesResult.meta.changes || 0} trades (>30min)`);
    } catch (error) {
      console.error('[Cleanup] Error:', error);
    }
  }

  async fetch(request: Request): Promise<Response> {
    return new Response('Cleanup Manager Running', { status: 200 });
  }
}

// Main Worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Initialize cleanup manager (singleton)
    const cleanupId = env.CLEANUP_MANAGER.idFromName('cleanup-manager');
    const cleanup = env.CLEANUP_MANAGER.get(cleanupId);

    // WebSocket routing to Durable Objects
    if (url.pathname === '/ws/lighter') {
      const id = env.LIGHTER_TRACKER.idFromName('lighter-tracker');
      const tracker = env.LIGHTER_TRACKER.get(id);
      return tracker.fetch(request);
    }

    if (url.pathname === '/ws/paradex') {
      const id = env.PARADEX_TRACKER.idFromName('paradex-tracker');
      const tracker = env.PARADEX_TRACKER.get(id);
      return tracker.fetch(request);
    }

    // API: Orderbook data
    if (url.pathname.startsWith('/api/orderbook/')) {
      const marketOrSymbol = url.pathname.replace('/api/orderbook/', '');
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? parseInt(limitParam) : null;
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const source = url.searchParams.get('source');
      const side = url.searchParams.get('side');
      let from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const timeframe = url.searchParams.get('timeframe');

      if (timeframe) {
        const now = Date.now();
        const timeframeMap: { [key: string]: number } = {
          '1m': 1 * 60 * 1000,
          '5m': 5 * 60 * 1000,
          '15m': 15 * 60 * 1000,
          '30m': 30 * 60 * 1000,
          '1h': 60 * 60 * 1000,
          '60m': 60 * 60 * 1000
        };

        if (timeframeMap[timeframe]) {
          from = String(now - timeframeMap[timeframe]);
        }
      }

      try {
        let query = 'SELECT * FROM orderbook_entries WHERE (market_id = ? OR normalized_symbol = ?)';
        const bindings: any[] = [marketOrSymbol, marketOrSymbol];

        if (source && (source === 'lighter' || source === 'paradex')) {
          query += ' AND source = ?';
          bindings.push(source);
        }

        if (side && (side === 'ask' || side === 'bid')) {
          query += ' AND side = ?';
          bindings.push(side);
        }

        if (from) {
          query += ' AND timestamp >= ?';
          bindings.push(parseInt(from));
        }

        if (to) {
          query += ' AND timestamp <= ?';
          bindings.push(parseInt(to));
        }

        query += ' ORDER BY timestamp DESC';

        if (limit !== null) {
          query += ' LIMIT ? OFFSET ?';
          bindings.push(limit, offset);
        }

        const result = await env.DB.prepare(query).bind(...bindings).all();

        return new Response(JSON.stringify({
          market: marketOrSymbol,
          entries: result.results || [],
          pagination: {
            limit: limit !== null ? limit : 'none',
            offset,
            count: result.results?.length || 0
          },
          filters: {
            source: source || 'all',
            side: side || 'all',
            timeframe: timeframe || null,
            from: from ? parseInt(from) : null,
            to: to ? parseInt(to) : null
          }
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

    // API: Paradex Trades
    if (url.pathname.startsWith('/api/trades/')) {
      const marketOrSymbol = url.pathname.replace('/api/trades/', '');
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? parseInt(limitParam) : null;
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const tradeType = url.searchParams.get('type');
      let from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const timeframe = url.searchParams.get('timeframe');

      if (timeframe) {
        const now = Date.now();
        const timeframeMap: { [key: string]: number } = {
          '1m': 1 * 60 * 1000,
          '5m': 5 * 60 * 1000,
          '15m': 15 * 60 * 1000,
          '30m': 30 * 60 * 1000,
          '1h': 60 * 60 * 1000,
          '60m': 60 * 60 * 1000
        };

        if (timeframeMap[timeframe]) {
          from = String(now - timeframeMap[timeframe]);
        }
      }

      try {
        let query = 'SELECT * FROM paradex_trades WHERE (market = ? OR normalized_symbol = ?)';
        const bindings: any[] = [marketOrSymbol, marketOrSymbol];

        if (tradeType && (tradeType === 'RPI' || tradeType === 'FILL')) {
          query += ' AND trade_type = ?';
          bindings.push(tradeType);
        }

        if (from) {
          query += ' AND created_at >= ?';
          bindings.push(parseInt(from));
        }

        if (to) {
          query += ' AND created_at <= ?';
          bindings.push(parseInt(to));
        }

        query += ' ORDER BY created_at DESC';

        if (limit !== null) {
          query += ' LIMIT ? OFFSET ?';
          bindings.push(limit, offset);
        }

        const result = await env.DB.prepare(query).bind(...bindings).all();

        return new Response(JSON.stringify({
          market: marketOrSymbol,
          trades: result.results || [],
          pagination: {
            limit: limit !== null ? limit : 'none',
            offset,
            count: result.results?.length || 0
          }
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

    // API: All markets
    if (url.pathname === '/api/markets') {
      try {
        const result = await env.DB.prepare(
          `SELECT * FROM token_mapping WHERE active = 1 ORDER BY normalized_symbol`
        ).all();

        return new Response(JSON.stringify({
          markets: result.results || []
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

    // API: Overview
    if (url.pathname === '/api/overview') {
      try {
        const orderbookStats = await env.DB.prepare(
          `SELECT
            normalized_symbol,
            source,
            COUNT(*) as total_entries,
            COUNT(CASE WHEN side = 'ask' THEN 1 END) as asks_count,
            COUNT(CASE WHEN side = 'bid' THEN 1 END) as bids_count,
            MAX(timestamp) as last_entry,
            MIN(timestamp) as first_entry
           FROM orderbook_entries
           GROUP BY normalized_symbol, source
           ORDER BY normalized_symbol, source`
        ).all();

        const tradeStats = await env.DB.prepare(
          `SELECT
            normalized_symbol,
            COUNT(*) as total_trades,
            COUNT(CASE WHEN trade_type = 'RPI' THEN 1 END) as rpi_count,
            COUNT(CASE WHEN trade_type = 'FILL' THEN 1 END) as fill_count,
            MAX(created_at) as last_trade
           FROM paradex_trades
           GROUP BY normalized_symbol
           ORDER BY normalized_symbol`
        ).all();

        const overview: any = {};

        for (const row of orderbookStats.results || []) {
          const symbol = row.normalized_symbol as string;
          if (!overview[symbol]) {
            overview[symbol] = {
              symbol,
              sources: {},
              trades: null
            };
          }

          overview[symbol].sources[row.source as string] = {
            total_entries: row.total_entries,
            asks_count: row.asks_count,
            bids_count: row.bids_count,
            last_entry: row.last_entry,
            first_entry: row.first_entry
          };
        }

        for (const row of tradeStats.results || []) {
          const symbol = row.normalized_symbol as string;
          if (!overview[symbol]) {
            overview[symbol] = {
              symbol,
              sources: {},
              trades: null
            };
          }

          overview[symbol].trades = {
            total_trades: row.total_trades,
            rpi_count: row.rpi_count,
            fill_count: row.fill_count,
            last_trade: row.last_trade
          };
        }

        const tokens = Object.values(overview).sort((a: any, b: any) =>
          a.symbol.localeCompare(b.symbol)
        );

        return new Response(JSON.stringify({
          tokens,
          timestamp: Date.now()
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

    // Frontend routes (keeping from old implementation)
    if (url.pathname === '/dashboard' || url.pathname === '/dashboard.html') {
      return new Response(DASHBOARD_HTML, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8'
        }
      });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(INDEX_HTML, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8'
        }
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};

// Frontend HTML (keeping the existing templates)
const INDEX_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Multi-Exchange Orderbook Tracker</title>
  <style>
    body { font-family: monospace; background: #0a0b0d; color: white; padding: 20px; }
    h1 { color: #00ff88; }
    .info { background: #1a1c26; padding: 20px; border-radius: 8px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>🏗️ MULTI-DO ORDERBOOK TRACKER</h1>
  <div class="info">
    <p><strong>Architecture:</strong> Separate Durable Objects for each exchange</p>
    <p><strong>Memory:</strong> 256 MB total (128 MB per exchange)</p>
    <p><strong>Dashboard:</strong> <a href="/dashboard">/dashboard</a></p>
  </div>
</body>
</html>`;

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Multi-DO Tracker Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Syne:wght@600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0b0d;
      --bg-secondary: #13141a;
      --bg-card: #1a1c26;
      --accent-green: #00ff88;
      --accent-red: #ff3366;
      --accent-blue: #00d4ff;
      --text-primary: #ffffff;
      --text-secondary: #8b92a8;
      --border: #2a2d3a;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'JetBrains Mono', monospace;
      background: var(--bg-primary);
      color: var(--text-primary);
      padding: 20px;
    }
    .container { max-width: 1600px; margin: 0 auto; }
    h1 {
      font-family: 'Syne', sans-serif;
      font-size: 48px;
      font-weight: 800;
      background: linear-gradient(135deg, var(--accent-green), var(--accent-blue));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-align: center;
      margin-bottom: 10px;
    }
    .subtitle {
      text-align: center;
      color: var(--text-secondary);
      margin-bottom: 30px;
      font-size: 14px;
    }
    .controls-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .control-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }
    .control-card h2 {
      font-family: 'Syne', sans-serif;
      font-size: 20px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .control-card.lighter h2 { color: var(--accent-green); }
    .control-card.paradex h2 { color: var(--accent-blue); }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--bg-secondary);
      border-radius: 20px;
      font-size: 12px;
      margin-bottom: 16px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-red);
    }
    .status-badge.active .status-dot { background: var(--accent-green); animation: pulse 2s infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .control-buttons {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
    }
    button {
      flex: 1;
      padding: 12px 20px;
      border: none;
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .btn-start {
      background: var(--accent-green);
      color: var(--bg-primary);
    }
    .btn-start:hover:not(:disabled) {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    .btn-stop {
      background: var(--accent-red);
      color: white;
    }
    .btn-stop:hover:not(:disabled) {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: var(--text-secondary); }
    .stat-value { color: var(--text-primary); font-weight: 600; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-card);
      border-radius: 12px;
      overflow: hidden;
      margin-top: 20px;
    }
    thead { background: var(--bg-secondary); }
    th, td {
      padding: 16px;
      text-align: left;
      font-size: 13px;
      border-bottom: 1px solid var(--border);
    }
    th {
      color: var(--text-secondary);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-size: 11px;
    }
    tbody tr:hover { background: var(--bg-secondary); }
    .token-symbol {
      font-weight: 700;
      font-size: 16px;
      color: var(--accent-green);
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      margin-right: 6px;
    }
    .badge-lighter {
      background: rgba(0, 255, 136, 0.15);
      color: var(--accent-green);
      border: 1px solid rgba(0, 255, 136, 0.3);
    }
    .badge-paradex {
      background: rgba(0, 212, 255, 0.15);
      color: var(--accent-blue);
      border: 1px solid rgba(0, 212, 255, 0.3);
    }
    .loading {
      text-align: center;
      padding: 40px;
      color: var(--text-secondary);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🏗️ MULTI-DO TRACKER</h1>
    <p class="subtitle">Independent Exchange Trackers • 256 MB Total Memory</p>

    <div class="controls-grid">
      <!-- Lighter Control -->
      <div class="control-card lighter">
        <h2>⚡ Lighter Exchange</h2>
        <div class="status-badge" id="lighterStatusBadge">
          <span class="status-dot"></span>
          <span id="lighterStatusText">Connecting...</span>
        </div>
        <div class="control-buttons">
          <button class="btn-start" id="lighterStartBtn">▶ Start</button>
          <button class="btn-stop" id="lighterStopBtn">⏸ Stop</button>
        </div>
        <div>
          <div class="stat-row">
            <span class="stat-label">Markets</span>
            <span class="stat-value" id="lighterMarkets">-</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Connected</span>
            <span class="stat-value" id="lighterConnected">-</span>
          </div>
        </div>
      </div>

      <!-- Paradex Control -->
      <div class="control-card paradex">
        <h2>🔷 Paradex Exchange</h2>
        <div class="status-badge" id="paradexStatusBadge">
          <span class="status-dot"></span>
          <span id="paradexStatusText">Connecting...</span>
        </div>
        <div class="control-buttons">
          <button class="btn-start" id="paradexStartBtn">▶ Start</button>
          <button class="btn-stop" id="paradexStopBtn">⏸ Stop</button>
        </div>
        <div>
          <div class="stat-row">
            <span class="stat-label">Markets</span>
            <span class="stat-value" id="paradexMarkets">-</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Connected</span>
            <span class="stat-value" id="paradexConnected">-</span>
          </div>
        </div>
      </div>
    </div>

    <div id="dataTable" class="loading">Loading data...</div>
  </div>

  <script>
    const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const WS_HOST = window.location.host;

    let lighterWs = null;
    let paradexWs = null;

    // Connect to Lighter Tracker
    function connectLighter() {
      lighterWs = new WebSocket(WS_PROTOCOL + '//' + WS_HOST + '/ws/lighter');

      lighterWs.onopen = () => {
        console.log('[Lighter] Connected');
        lighterWs.send(JSON.stringify({ type: 'get_stats' }));
      };

      lighterWs.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stats') {
          updateLighterStatus(msg.data);
        } else if (msg.type === 'control') {
          alert(msg.data.message);
          lighterWs.send(JSON.stringify({ type: 'get_stats' }));
        } else if (msg.type === 'tracking_status') {
          updateLighterStatus(msg.data);
        }
      };

      lighterWs.onclose = () => {
        console.log('[Lighter] Disconnected');
        setTimeout(connectLighter, 5000);
      };
    }

    // Connect to Paradex Tracker
    function connectParadex() {
      paradexWs = new WebSocket(WS_PROTOCOL + '//' + WS_HOST + '/ws/paradex');

      paradexWs.onopen = () => {
        console.log('[Paradex] Connected');
        paradexWs.send(JSON.stringify({ type: 'get_stats' }));
      };

      paradexWs.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stats') {
          updateParadexStatus(msg.data);
        } else if (msg.type === 'control') {
          alert(msg.data.message);
          paradexWs.send(JSON.stringify({ type: 'get_stats' }));
        } else if (msg.type === 'tracking_status') {
          updateParadexStatus(msg.data);
        }
      };

      paradexWs.onclose = () => {
        console.log('[Paradex] Disconnected');
        setTimeout(connectParadex, 5000);
      };
    }

    // Update Lighter UI
    function updateLighterStatus(data) {
      const badge = document.getElementById('lighterStatusBadge');
      const statusText = document.getElementById('lighterStatusText');
      const startBtn = document.getElementById('lighterStartBtn');
      const stopBtn = document.getElementById('lighterStopBtn');

      const isTracking = data.isTracking || false;

      if (isTracking) {
        badge.classList.add('active');
        statusText.textContent = '🟢 Running';
        startBtn.disabled = true;
        stopBtn.disabled = false;
      } else {
        badge.classList.remove('active');
        statusText.textContent = '🔴 Stopped';
        startBtn.disabled = false;
        stopBtn.disabled = true;
      }

      document.getElementById('lighterMarkets').textContent = data.markets || 0;
      document.getElementById('lighterConnected').textContent = data.connected ? '✅ Yes' : '❌ No';
    }

    // Update Paradex UI
    function updateParadexStatus(data) {
      const badge = document.getElementById('paradexStatusBadge');
      const statusText = document.getElementById('paradexStatusText');
      const startBtn = document.getElementById('paradexStartBtn');
      const stopBtn = document.getElementById('paradexStopBtn');

      const isTracking = data.isTracking || false;

      if (isTracking) {
        badge.classList.add('active');
        statusText.textContent = '🟢 Running';
        startBtn.disabled = true;
        stopBtn.disabled = false;
      } else {
        badge.classList.remove('active');
        statusText.textContent = '🔴 Stopped';
        startBtn.disabled = false;
        stopBtn.disabled = true;
      }

      document.getElementById('paradexMarkets').textContent = data.markets || 0;
      document.getElementById('paradexConnected').textContent = data.connected ? '✅ Yes' : '❌ No';
    }

    // Button handlers
    document.getElementById('lighterStartBtn').addEventListener('click', () => {
      if (lighterWs && lighterWs.readyState === WebSocket.OPEN) {
        lighterWs.send(JSON.stringify({ type: 'start_tracking' }));
      }
    });

    document.getElementById('lighterStopBtn').addEventListener('click', () => {
      if (lighterWs && lighterWs.readyState === WebSocket.OPEN) {
        lighterWs.send(JSON.stringify({ type: 'stop_tracking' }));
      }
    });

    document.getElementById('paradexStartBtn').addEventListener('click', () => {
      if (paradexWs && paradexWs.readyState === WebSocket.OPEN) {
        paradexWs.send(JSON.stringify({ type: 'start_tracking' }));
      }
    });

    document.getElementById('paradexStopBtn').addEventListener('click', () => {
      if (paradexWs && paradexWs.readyState === WebSocket.OPEN) {
        paradexWs.send(JSON.stringify({ type: 'stop_tracking' }));
      }
    });

    // Load data table
    async function loadData() {
      try {
        const response = await fetch('/api/overview');
        const data = await response.json();

        if (!data.tokens || data.tokens.length === 0) {
          document.getElementById('dataTable').innerHTML = '<div class="loading">📭 Keine Daten in der Datenbank</div>';
          return;
        }

        let html = '<table><thead><tr><th>Token</th><th>Sources</th><th>Lighter Entries</th><th>Paradex Entries</th><th>Paradex Trades</th></tr></thead><tbody>';

        for (const token of data.tokens) {
          const lighter = token.sources.lighter || {};
          const paradex = token.sources.paradex || {};
          const trades = token.trades || {};

          html += '<tr>';
          html += '<td><div class="token-symbol">' + token.symbol + '</div></td>';
          html += '<td>';
          if (lighter.total_entries) html += '<span class="badge badge-lighter">Lighter</span>';
          if (paradex.total_entries) html += '<span class="badge badge-paradex">Paradex</span>';
          html += '</td>';
          html += '<td>' + (lighter.total_entries || '-') + '</td>';
          html += '<td>' + (paradex.total_entries || '-') + '</td>';
          html += '<td>' + (trades.total_trades || '-') + '</td>';
          html += '</tr>';
        }

        html += '</tbody></table>';
        document.getElementById('dataTable').innerHTML = html;
      } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('dataTable').innerHTML = '<div class="loading">❌ Fehler beim Laden</div>';
      }
    }

    // Initialize
    connectLighter();
    connectParadex();
    loadData();
    setInterval(loadData, 30000);
  </script>
</body>
</html>`;
