/**
 * Multi-Exchange Orderbook Tracker
 * Tracks orderbook data from Lighter and Paradex
 */

export interface Env {
  ORDERBOOK_TRACKER: DurableObjectNamespace;
  DB: D1Database;
}

// Frontend HTML Templates
const INDEX_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Multi-Exchange Orderbook Tracker</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0b0d;
      --bg-secondary: #13141a;
      --bg-card: #1a1c26;
      --accent-green: #00ff88;
      --accent-red: #ff3366;
      --accent-blue: #00d4ff;
      --accent-purple: #b64eff;
      --text-primary: #ffffff;
      --text-secondary: #8b92a8;
      --border: #2a2d3a;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'JetBrains Mono', monospace;
      background: var(--bg-primary);
      color: var(--text-primary);
      overflow-x: hidden;
      position: relative;
    }
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px);
      background-size: 50px 50px;
      opacity: 0.3;
      animation: gridMove 20s linear infinite;
      pointer-events: none;
      z-index: 0;
    }
    @keyframes gridMove {
      0% { transform: translate(0, 0); }
      100% { transform: translate(50px, 50px); }
    }
    .orb {
      position: fixed;
      border-radius: 50%;
      filter: blur(80px);
      pointer-events: none;
      z-index: 0;
      animation: float 8s ease-in-out infinite;
    }
    .orb-1 {
      width: 400px;
      height: 400px;
      background: var(--accent-green);
      top: -200px;
      left: -200px;
      opacity: 0.1;
    }
    .orb-2 {
      width: 300px;
      height: 300px;
      background: var(--accent-purple);
      bottom: -150px;
      right: -150px;
      opacity: 0.08;
      animation-delay: -4s;
    }
    @keyframes float {
      0%, 100% { transform: translate(0, 0) scale(1); }
      50% { transform: translate(30px, -30px) scale(1.1); }
    }
    .container { max-width: 1600px; margin: 0 auto; padding: 40px 20px; position: relative; z-index: 1; }
    header { margin-bottom: 40px; text-align: center; }
    h1 {
      font-family: 'Syne', sans-serif;
      font-size: 72px;
      font-weight: 800;
      background: linear-gradient(135deg, var(--accent-green), var(--accent-blue));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 16px;
      letter-spacing: -2px;
      animation: slideDown 0.8s ease-out;
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .subtitle { font-size: 18px; color: var(--text-secondary); animation: fadeIn 1s ease-out 0.3s both; }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .connections { display: flex; gap: 16px; justify-content: center; margin-top: 24px; flex-wrap: wrap; }
    .connection-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 20px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 30px;
      font-size: 13px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-red);
      animation: pulse 2s ease-in-out infinite;
    }
    .connection-badge.connected .status-dot { background: var(--accent-green); }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.9); }
    }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 40px; }
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-green), var(--accent-blue));
    }
    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-secondary);
      margin-bottom: 12px;
      font-weight: 600;
    }
    .stat-value {
      font-size: 36px;
      font-weight: 700;
      font-family: 'Syne', sans-serif;
      color: var(--accent-green);
    }
    .stat-sub { font-size: 11px; color: var(--text-secondary); margin-top: 8px; }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 30px;
      margin-bottom: 30px;
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-green), var(--accent-blue));
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    .card:hover::before { opacity: 1; }
    .card-title {
      font-family: 'Syne', sans-serif;
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    table { width: 100%; border-collapse: collapse; }
    thead { background: var(--bg-secondary); }
    th {
      padding: 16px;
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-secondary);
      font-weight: 600;
      border-bottom: 1px solid var(--border);
    }
    tbody tr { border-bottom: 1px solid var(--border); transition: all 0.2s ease; }
    tbody tr:hover { background: var(--bg-secondary); }
    td { padding: 16px; font-size: 14px; }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
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
    .empty-state { text-align: center; padding: 60px 20px; color: var(--text-secondary); }
    .empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.3; }
    .loading {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--border);
      border-top-color: var(--accent-green);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .info-box {
      background: rgba(0, 212, 255, 0.1);
      border: 1px solid rgba(0, 212, 255, 0.3);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
      font-size: 13px;
      color: var(--accent-blue);
    }
    .info-box strong { display: block; margin-bottom: 8px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="container">
    <header>
      <h1>ORDERBOOK TRACKER</h1>
      <p class="subtitle">Multi-Exchange Orderbook Data • Lighter + Paradex • Automatisches Tracking ALLER Markets</p>
      <div class="connections">
        <div id="lighterBadge" class="connection-badge">
          <span class="status-dot"></span>
          <span>Lighter: <span id="lighterStatus">Connecting...</span></span>
        </div>
        <div id="paradexBadge" class="connection-badge">
          <span class="status-dot"></span>
          <span>Paradex: <span id="paradexStatus">Connecting...</span></span>
        </div>
      </div>
    </header>
    <div class="info-box">
      <strong>🚀 Automatisches Tracking</strong>
      Dieser Tracker überwacht automatisch ALLE verfügbaren Markets von Lighter und Paradex. Keine Konfiguration notwendig - alle Orderbook-Daten und Paradex-Trades (inkl. RPI) werden persistent gespeichert!
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Lighter Markets</div>
        <div class="stat-value" id="statLighterMarkets">-</div>
        <div class="stat-sub" id="statLighterEntries">- Einträge</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Paradex Markets</div>
        <div class="stat-value" id="statParadexMarkets">-</div>
        <div class="stat-sub" id="statParadexEntries">- Einträge</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Paradex RPI Trades</div>
        <div class="stat-value" id="statRPITrades">-</div>
        <div class="stat-sub" id="statTotalTrades">- Trades gesamt</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Unique Symbols</div>
        <div class="stat-value" id="statUniqueSymbols">-</div>
        <div class="stat-sub">Normalisierte Token</div>
      </div>
    </div>
    <div class="card">
      <h2 class="card-title"><span>📊</span>Tracked Markets</h2>
      <div id="marketsTable">
        <div class="empty-state">
          <div class="empty-icon">⏳</div>
          <p>Loading markets...</p>
        </div>
      </div>
    </div>
    <div class="card">
      <h2 class="card-title"><span>💹</span>API Endpoints</h2>
      <div style="font-size: 14px; line-height: 1.8;">
        <p style="margin-bottom: 16px;"><strong>Orderbook Daten abrufen:</strong></p>
        <code style="background: var(--bg-secondary); padding: 4px 8px; border-radius: 4px;">
          GET /api/orderbook/{market_or_symbol}?source=lighter|paradex&timeframe=1m|5m|15m|30m|1h&side=ask|bid&limit=100
        </code>
        <p style="margin: 24px 0 16px;"><strong>Paradex Trades abrufen:</strong></p>
        <code style="background: var(--bg-secondary); padding: 4px 8px; border-radius: 4px;">
          GET /api/trades/{market_or_symbol}?type=RPI|FILL&timeframe=1m|5m|15m|30m|1h&limit=100
        </code>
        <p style="margin: 24px 0 16px;"><strong>Alle verfügbaren Markets:</strong></p>
        <code style="background: var(--bg-secondary); padding: 4px 8px; border-radius: 4px;">GET /api/markets</code>
      </div>
    </div>
  </div>
  <script>
    const WS_URL = window.location.protocol === 'https:' ? 'wss://' + window.location.host + '/ws' : 'ws://' + window.location.host + '/ws';
    let ws = null;
    let reconnectTimer = null;
    let markets = [];
    document.addEventListener('DOMContentLoaded', () => {
      connectWebSocket();
      loadMarkets();
      setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'get_stats' }));
        }
      }, 10000);
    });
    function connectWebSocket() {
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => {
          console.log('WebSocket connected');
          ws.send(JSON.stringify({ type: 'get_stats' }));
          ws.send(JSON.stringify({ type: 'get_markets' }));
        };
        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          handleMessage(message);
        };
        ws.onclose = () => {
          console.log('WebSocket disconnected');
          updateConnectionStatus(false, false);
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectWebSocket, 5000);
        };
        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      } catch (error) {
        console.error('Failed to connect:', error);
      }
    }
    function handleMessage(message) {
      switch (message.type) {
        case 'stats':
          updateStats(message.data);
          break;
        case 'markets':
          markets = message.data;
          break;
      }
    }
    function updateStats(data) {
      updateConnectionStatus(data.lighter_connected, data.paradex_connected);
      document.getElementById('statLighterMarkets').textContent = data.lighter_markets || 0;
      document.getElementById('statParadexMarkets').textContent = data.paradex_markets || 0;
      const lighterStats = data.orderbook.find(s => s.source === 'lighter');
      const paradexStats = data.orderbook.find(s => s.source === 'paradex');
      document.getElementById('statLighterEntries').textContent = (lighterStats?.total_entries || 0).toLocaleString('de-DE') + ' Einträge';
      document.getElementById('statParadexEntries').textContent = (paradexStats?.total_entries || 0).toLocaleString('de-DE') + ' Einträge';
      document.getElementById('statRPITrades').textContent = (data.trades?.rpi_trades || 0).toLocaleString('de-DE');
      document.getElementById('statTotalTrades').textContent = (data.trades?.total_trades || 0).toLocaleString('de-DE') + ' Trades gesamt';
      const uniqueSymbols = new Set([
        ...((lighterStats?.unique_symbols || 0) > 0 ? [lighterStats.unique_symbols] : []),
        ...((paradexStats?.unique_symbols || 0) > 0 ? [paradexStats.unique_symbols] : [])
      ]);
      document.getElementById('statUniqueSymbols').textContent = Math.max(lighterStats?.unique_symbols || 0, paradexStats?.unique_symbols || 0);
    }
    function updateConnectionStatus(lighterConnected, paradexConnected) {
      const lighterBadge = document.getElementById('lighterBadge');
      const lighterStatus = document.getElementById('lighterStatus');
      const paradexBadge = document.getElementById('paradexBadge');
      const paradexStatus = document.getElementById('paradexStatus');
      if (lighterConnected) {
        lighterBadge.classList.add('connected');
        lighterStatus.textContent = 'Connected';
      } else {
        lighterBadge.classList.remove('connected');
        lighterStatus.textContent = 'Disconnected';
      }
      if (paradexConnected) {
        paradexBadge.classList.add('connected');
        paradexStatus.textContent = 'Connected';
      } else {
        paradexBadge.classList.remove('connected');
        paradexStatus.textContent = 'Disconnected';
      }
    }
    async function loadMarkets() {
      try {
        const response = await fetch('/api/markets');
        const data = await response.json();
        updateMarketsTable(data.markets || []);
      } catch (error) {
        console.error('Failed to load markets:', error);
      }
    }
    function updateMarketsTable(marketList) {
      const container = document.getElementById('marketsTable');
      if (marketList.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>Keine Markets gefunden</p></div>';
        return;
      }
      const grouped = {};
      for (const market of marketList) {
        if (!grouped[market.normalized_symbol]) {
          grouped[market.normalized_symbol] = [];
        }
        grouped[market.normalized_symbol].push(market);
      }
      const html = '<table><thead><tr><th>Symbol</th><th>Base Asset</th><th>Quote Asset</th><th>Type</th><th>Sources</th><th>Market IDs</th></tr></thead><tbody>' +
        Object.keys(grouped).sort().map(symbol => {
          const markets = grouped[symbol];
          const sources = markets.map(m => m.source);
          const marketIds = markets.map(m => m.source + ':' + m.original_symbol).join(', ');
          return '<tr><td><strong>' + symbol + '</strong></td><td>' + markets[0].base_asset + '</td><td>' + markets[0].quote_asset + '</td><td>' + markets[0].market_type + '</td><td>' +
            (sources.includes('lighter') ? '<span class="badge badge-lighter">Lighter</span> ' : '') +
            (sources.includes('paradex') ? '<span class="badge badge-paradex">Paradex</span>' : '') +
            '</td><td style="font-size: 11px; color: var(--text-secondary);">' + marketIds + '</td></tr>';
        }).join('') + '</tbody></table>';
      container.innerHTML = html;
    }
  </script>
</body>
</html>`;

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Database Overview - Orderbook Tracker</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0b0d;
      --bg-secondary: #13141a;
      --bg-card: #1a1c26;
      --accent-green: #00ff88;
      --accent-red: #ff3366;
      --accent-blue: #00d4ff;
      --accent-purple: #b64eff;
      --text-primary: #ffffff;
      --text-secondary: #8b92a8;
      --border: #2a2d3a;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'JetBrains Mono', monospace; background: var(--bg-primary); color: var(--text-primary); padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    h1 {
      font-family: 'Syne', sans-serif;
      font-size: 48px;
      font-weight: 800;
      background: linear-gradient(135deg, var(--accent-green), var(--accent-blue));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 8px;
    }
    .subtitle { font-size: 14px; color: var(--text-secondary); }
    .refresh-info {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 20px;
      font-size: 12px;
      margin-top: 16px;
    }
    .refresh-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-green);
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .container { max-width: 1600px; margin: 0 auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-card);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    thead { background: var(--bg-secondary); }
    th {
      padding: 16px;
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-secondary);
      font-weight: 600;
      border-bottom: 2px solid var(--border);
    }
    tbody tr { border-bottom: 1px solid var(--border); transition: background 0.2s ease; }
    tbody tr:hover { background: var(--bg-secondary); }
    tbody tr.updated { animation: highlight 1s ease; }
    @keyframes highlight {
      0%, 100% { background: var(--bg-card); }
      50% { background: rgba(0, 255, 136, 0.1); }
    }
    td { padding: 16px; font-size: 14px; }
    .token-symbol {
      font-size: 18px;
      font-weight: 700;
      font-family: 'Syne', sans-serif;
      color: var(--accent-green);
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
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
    .stat { font-family: 'JetBrains Mono', monospace; font-size: 13px; }
    .stat-label {
      color: var(--text-secondary);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: block;
      margin-bottom: 4px;
    }
    .stat-value { color: var(--text-primary); font-weight: 600; }
    .timestamp { font-size: 11px; color: var(--text-secondary); }
    .time-ago { font-size: 10px; color: var(--accent-blue); font-style: italic; }
    .empty-state { text-align: center; padding: 60px 20px; color: var(--text-secondary); }
    .loading {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid var(--border);
      border-top-color: var(--accent-green);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .no-data { color: var(--text-secondary); font-size: 12px; font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 DATABASE OVERVIEW</h1>
      <p class="subtitle">Live-Übersicht aller gespeicherten Token-Daten</p>
      <div class="refresh-info">
        <span class="refresh-dot"></span>
        <span>Auto-Refresh alle 30 Sekunden</span>
        <span id="lastUpdate" style="margin-left: 12px; opacity: 0.6;">-</span>
      </div>
      <div style="margin-top: 20px; display: flex; gap: 12px; justify-content: center;">
        <button id="startBtn" style="padding: 10px 24px; background: var(--accent-green); color: var(--bg-primary); border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-family: inherit; font-size: 14px;">▶ Start Tracking</button>
        <button id="stopBtn" style="padding: 10px 24px; background: var(--accent-red); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-family: inherit; font-size: 14px;">⏸ Stop Tracking</button>
        <span id="trackingStatus" style="padding: 10px 20px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; font-size: 13px;">Status: <span id="statusText">...</span></span>
      </div>
    </div>
    <div id="tableContainer">
      <div class="empty-state">
        <div class="loading"></div>
        <p style="margin-top: 16px;">Lade Daten...</p>
      </div>
    </div>
  </div>
  <script>
    const API_URL = '/api/overview';
    const WS_URL = window.location.protocol === 'https:' ? 'wss://' + window.location.host + '/ws' : 'ws://' + window.location.host + '/ws';
    let previousData = new Map();
    let ws = null;

    // Connect to WebSocket for tracking controls
    function connectWebSocket() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        console.log('WebSocket connected');
        ws.send(JSON.stringify({ type: 'get_stats' }));
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'stats') {
          updateTrackingStatus(message.data.is_tracking);
        } else if (message.type === 'tracking_control') {
          alert(message.data.message);
          ws.send(JSON.stringify({ type: 'get_stats' }));
        } else if (message.type === 'tracking_status') {
          updateTrackingStatus(message.data.isTracking);
        }
      };
      ws.onclose = () => {
        setTimeout(connectWebSocket, 5000);
      };
    }

    function updateTrackingStatus(isTracking) {
      const statusText = document.getElementById('statusText');
      const startBtn = document.getElementById('startBtn');
      const stopBtn = document.getElementById('stopBtn');

      if (isTracking) {
        statusText.textContent = '🟢 Running';
        statusText.style.color = 'var(--accent-green)';
        startBtn.disabled = true;
        startBtn.style.opacity = '0.5';
        stopBtn.disabled = false;
        stopBtn.style.opacity = '1';
      } else {
        statusText.textContent = '🔴 Stopped';
        statusText.style.color = 'var(--accent-red)';
        startBtn.disabled = false;
        startBtn.style.opacity = '1';
        stopBtn.disabled = true;
        stopBtn.style.opacity = '0.5';
      }
    }

    // Button handlers
    document.getElementById('startBtn').addEventListener('click', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'start_tracking' }));
      }
    });

    document.getElementById('stopBtn').addEventListener('click', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop_tracking' }));
      }
    });

    connectWebSocket();
    loadData();
    setInterval(loadData, 30000);
    async function loadData() {
      try {
        const response = await fetch(API_URL);
        const data = await response.json();
        renderTable(data.tokens);
        updateLastUpdateTime();
      } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('tableContainer').innerHTML = '<div class="empty-state"><p style="color: var(--accent-red);">❌ Fehler beim Laden der Daten</p><p style="font-size: 12px; margin-top: 8px;">' + error.message + '</p></div>';
      }
    }
    function renderTable(tokens) {
      const container = document.getElementById('tableContainer');
      if (!tokens || tokens.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>📭 Keine Daten in der Datenbank</p><p style="font-size: 12px; margin-top: 8px; opacity: 0.6;">Warte auf erste Orderbook-Updates...</p></div>';
        return;
      }
      const html = '<table><thead><tr><th>Token</th><th>Sources</th><th>Lighter Einträge</th><th>Paradex Einträge</th><th>Paradex Trades</th><th>Letzter Eintrag</th></tr></thead><tbody>' +
        tokens.map(token => renderTokenRow(token)).join('') + '</tbody></table>';
      container.innerHTML = html;
    }
    function renderTokenRow(token) {
      const lighter = token.sources.lighter || null;
      const paradex = token.sources.paradex || null;
      const trades = token.trades || null;
      const prevKey = token.symbol;
      const prevData = previousData.get(prevKey);
      const currentData = {
        lighter: lighter?.total_entries || 0,
        paradex: paradex?.total_entries || 0,
        trades: trades?.total_trades || 0
      };
      const hasChanged = prevData && (prevData.lighter !== currentData.lighter || prevData.paradex !== currentData.paradex || prevData.trades !== currentData.trades);
      previousData.set(prevKey, currentData);
      let latestTimestamp = 0;
      if (lighter && lighter.last_entry > latestTimestamp) latestTimestamp = lighter.last_entry;
      if (paradex && paradex.last_entry > latestTimestamp) latestTimestamp = paradex.last_entry;
      if (trades && trades.last_trade > latestTimestamp) latestTimestamp = trades.last_trade;
      return '<tr class="' + (hasChanged ? 'updated' : '') + '"><td><div class="token-symbol">' + token.symbol + '</div></td><td>' +
        (lighter ? '<span class="badge badge-lighter">Lighter</span>' : '') +
        (paradex ? '<span class="badge badge-paradex">Paradex</span>' : '') +
        '</td><td>' +
        (lighter ? '<div class="stat"><span class="stat-label">Total</span><span class="stat-value">' + formatNumber(lighter.total_entries) + '</span><span style="font-size: 11px; color: var(--text-secondary); margin-left: 8px;">(' + formatNumber(lighter.asks_count) + ' asks, ' + formatNumber(lighter.bids_count) + ' bids)</span></div>' : '<span class="no-data">-</span>') +
        '</td><td>' +
        (paradex ? '<div class="stat"><span class="stat-label">Total</span><span class="stat-value">' + formatNumber(paradex.total_entries) + '</span><span style="font-size: 11px; color: var(--text-secondary); margin-left: 8px;">(' + formatNumber(paradex.asks_count) + ' asks, ' + formatNumber(paradex.bids_count) + ' bids)</span></div>' : '<span class="no-data">-</span>') +
        '</td><td>' +
        (trades ? '<div class="stat"><span class="stat-label">Total</span><span class="stat-value">' + formatNumber(trades.total_trades) + '</span><span style="font-size: 11px; color: var(--text-secondary); margin-left: 8px;">(' + formatNumber(trades.rpi_count) + ' RPI, ' + formatNumber(trades.fill_count) + ' FILL)</span></div>' : '<span class="no-data">-</span>') +
        '</td><td>' +
        (latestTimestamp ? '<div class="timestamp">' + formatTimestamp(latestTimestamp) + '</div><div class="time-ago">' + getTimeAgo(latestTimestamp) + '</div>' : '<span class="no-data">-</span>') +
        '</td></tr>';
    }
    function formatNumber(num) {
      return num ? num.toLocaleString('de-DE') : '0';
    }
    function formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    function getTimeAgo(timestamp) {
      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return 'vor ' + days + ' Tag' + (days > 1 ? 'en' : '');
      if (hours > 0) return 'vor ' + hours + ' Stunde' + (hours > 1 ? 'n' : '');
      if (minutes > 0) return 'vor ' + minutes + ' Minute' + (minutes > 1 ? 'n' : '');
      return 'vor ' + seconds + ' Sekunde' + (seconds !== 1 ? 'n' : '');
    }
    function updateLastUpdateTime() {
      const now = new Date();
      document.getElementById('lastUpdate').textContent = now.toLocaleTimeString('de-DE');
    }
  </script>
</body>
</html>`;

// Durable Object für persistentes Orderbook-Tracking
export class OrderbookTracker {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Set<WebSocket>;

  // Exchange WebSocket connections
  private lighterWs: WebSocket | null = null;
  private paradexWs: WebSocket | null = null;

  // Ping intervals for keepalive
  private lighterPingInterval: any = null;
  private paradexPingInterval: any = null;

  // Reconnect timeouts
  private lighterReconnectTimeout: any = null;
  private paradexReconnectTimeout: any = null;

  // Cleanup interval for old data
  private cleanupInterval: any = null;

  // Token mappings cache
  private tokenMappings: Map<string, TokenMapping> = new Map();

  // Tracked markets
  private lighterMarkets: Set<string> = new Set();
  private paradexMarkets: Set<string> = new Set();

  // Tracking state
  private isTracking: boolean = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();

    // Load tracking state
    this.state.blockConcurrencyWhile(async () => {
      this.isTracking = await this.state.storage.get<boolean>('isTracking') ?? false;
    });

    // Auto-start tracking on initialization only if enabled
    if (this.isTracking) {
      this.initialize();
    }
  }

  async initialize() {
    // Load token mappings from database
    await this.loadTokenMappings();

    // Discover and track ALL available markets
    await this.discoverAndTrackMarkets();

    // Connect to exchanges
    await this.connectToLighter();
    await this.connectToParadex();
  }

  async loadTokenMappings() {
    try {
      const result = await this.env.DB.prepare(
        `SELECT * FROM token_mapping WHERE active = 1`
      ).all();

      for (const row of result.results || []) {
        const key = `${row.source}:${row.original_symbol}`;
        this.tokenMappings.set(key, row as TokenMapping);
      }

      console.log(`Loaded ${this.tokenMappings.size} token mappings`);
    } catch (error) {
      console.error('Error loading token mappings:', error);
    }
  }

  async discoverAndTrackMarkets() {
    try {
      // Discover ALL Lighter markets
      const lighterResponse = await fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBooks');
      const lighterData = await lighterResponse.json();

      if (lighterData.code === 200 && lighterData.order_books) {
        // Track ALL active markets
        for (const market of lighterData.order_books) {
          if (market.status === 'active') {
            this.lighterMarkets.add(market.market_id);
            await this.ensureTokenMapping('lighter', market.market_id, market.symbol);
          }
        }
        console.log(`Tracking ${this.lighterMarkets.size} Lighter markets (ALL active markets)`);
      }

      // Discover ALL Paradex markets
      const paradexResponse = await fetch('https://api.prod.paradex.trade/v1/markets');
      const paradexData = await paradexResponse.json();

      if (paradexData.results) {
        // Track ONLY PERP markets (exclude OPTIONS)
        const perpMarkets = paradexData.results.filter((m: any) =>
          m.market_type === 'PERP' && !m.symbol.includes('OPTION')
        );

        console.log(`Found ${perpMarkets.length} Paradex PERP markets (excluding options)`);

        for (const market of perpMarkets) {
          this.paradexMarkets.add(market.symbol);

          // Extract normalized symbol (e.g., ETH-USD-PERP -> ETH)
          const baseAsset = market.symbol.split('-')[0];
          await this.ensureTokenMapping('paradex', market.symbol, baseAsset);
        }
        console.log(`Tracking ${this.paradexMarkets.size} Paradex markets (PERP only, no options)`);
      }

      // Start periodic cleanup (every 30 minutes)
      this.startPeriodicCleanup();
    } catch (error) {
      console.error('Error discovering markets:', error);
    }
  }

  async ensureTokenMapping(source: string, originalSymbol: string, normalizedSymbol: string) {
    const key = `${source}:${originalSymbol}`;

    if (!this.tokenMappings.has(key)) {
      try {
        // Parse base/quote/type from symbol
        let baseAsset = normalizedSymbol;
        let quoteAsset = 'USD';
        let marketType = 'PERP';

        if (source === 'paradex' && originalSymbol.includes('-')) {
          const parts = originalSymbol.split('-');
          baseAsset = parts[0];
          quoteAsset = parts[1];
          marketType = parts[2] || 'PERP';
        }

        await this.env.DB.prepare(
          `INSERT OR IGNORE INTO token_mapping
           (source, original_symbol, normalized_symbol, base_asset, quote_asset, market_type, active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`
        ).bind(source, originalSymbol, baseAsset, baseAsset, quoteAsset, marketType).run();

        this.tokenMappings.set(key, {
          source,
          original_symbol: originalSymbol,
          normalized_symbol: baseAsset,
          base_asset: baseAsset,
          quote_asset: quoteAsset,
          market_type: marketType,
          active: 1
        });
      } catch (error) {
        console.error('Error creating token mapping:', error);
      }
    }
  }

  getNormalizedSymbol(source: string, originalSymbol: string): string {
    const key = `${source}:${originalSymbol}`;
    const mapping = this.tokenMappings.get(key);
    return mapping?.normalized_symbol || originalSymbol;
  }

  // ========== Lighter WebSocket ==========

  async connectToLighter() {
    try {
      const ws = new WebSocket('wss://mainnet.zklighter.elliot.ai/stream');

      ws.addEventListener('open', () => {
        console.log('✅ Connected to Lighter WebSocket');

        // Subscribe to ALL markets
        for (const marketId of this.lighterMarkets) {
          this.subscribeLighterOrderbook(marketId);
        }

        // Start keepalive ping
        this.startLighterPing();
      });

      ws.addEventListener('message', (event) => {
        this.handleLighterMessage(event.data);
      });

      ws.addEventListener('close', () => {
        console.log('❌ Disconnected from Lighter');
        this.lighterWs = null;
        this.stopLighterPing();

        // Auto-reconnect
        this.lighterReconnectTimeout = setTimeout(() => {
          this.connectToLighter();
        }, 5000);
      });

      ws.addEventListener('error', (error: any) => {
        console.error('Lighter WebSocket error:', error);
      });

      this.lighterWs = ws;
    } catch (error) {
      console.error('Failed to connect to Lighter:', error);
    }
  }

  subscribeLighterOrderbook(marketId: string) {
    if (this.lighterWs && this.lighterWs.readyState === WebSocket.OPEN) {
      this.lighterWs.send(JSON.stringify({
        type: 'subscribe',
        channel: `order_book/${marketId}`
      }));
      console.log(`📚 Subscribed to Lighter order_book/${marketId}`);
    }
  }

  startLighterPing() {
    this.stopLighterPing();
    this.lighterPingInterval = setInterval(() => {
      if (this.lighterWs && this.lighterWs.readyState === WebSocket.OPEN) {
        this.lighterWs.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  stopLighterPing() {
    if (this.lighterPingInterval) {
      clearInterval(this.lighterPingInterval);
      this.lighterPingInterval = null;
    }
  }

  async handleLighterMessage(data: string) {
    try {
      const message = JSON.parse(data);

      // Orderbook Updates
      if (message.channel && message.channel.startsWith('order_book:')) {
        const marketId = message.channel.replace('order_book:', '');
        await this.saveLighterOrderbookUpdate(marketId, message);
      }
    } catch (error) {
      console.error('Error parsing Lighter message:', error);
    }
  }

  async saveLighterOrderbookUpdate(marketId: string, message: any) {
    try {
      const { order_book, timestamp } = message;
      if (!order_book) return;

      const { asks, bids, offset, nonce } = order_book;
      const normalizedSymbol = this.getNormalizedSymbol('lighter', marketId);

      // Limit to 1 ask and 1 bid (best price only) to save memory
      const limitedAsks = asks?.slice(0, 1) || [];
      const limitedBids = bids?.slice(0, 1) || [];

      // Batch insert using single statement
      if (limitedAsks.length > 0 || limitedBids.length > 0) {
        const values: string[] = [];
        const bindings: any[] = [];

        // Build batch insert for asks
        for (const ask of limitedAsks) {
          values.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
          bindings.push(
            'lighter', marketId, normalizedSymbol, 'ask',
            parseFloat(ask.price), parseFloat(ask.size),
            timestamp, offset, nonce
          );
        }

        // Build batch insert for bids
        for (const bid of limitedBids) {
          values.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
          bindings.push(
            'lighter', marketId, normalizedSymbol, 'bid',
            parseFloat(bid.price), parseFloat(bid.size),
            timestamp, offset, nonce
          );
        }

        // Single batch insert
        const query = `INSERT INTO orderbook_entries
          (source, market_id, normalized_symbol, side, price, size, timestamp, offset, nonce)
          VALUES ${values.join(', ')}`;

        await this.env.DB.prepare(query).bind(...bindings).run();

        console.log(`📚 Lighter: Saved ${values.length} entries for ${normalizedSymbol}`);
      }
    } catch (error) {
      console.error('Error saving Lighter orderbook:', error);
    }
  }

  // ========== Paradex WebSocket ==========

  async connectToParadex() {
    try {
      const ws = new WebSocket('wss://ws.api.prod.paradex.trade/v1');

      ws.addEventListener('open', () => {
        console.log('✅ Connected to Paradex WebSocket');

        // Subscribe to ALL orderbooks
        for (const market of this.paradexMarkets) {
          this.subscribeParadexOrderbook(market);
        }

        // Subscribe to ALL trades (for RPI data)
        this.subscribeParadexTrades();

        // Start keepalive ping
        this.startParadexPing();
      });

      ws.addEventListener('message', (event) => {
        this.handleParadexMessage(event.data);
      });

      ws.addEventListener('close', () => {
        console.log('❌ Disconnected from Paradex');
        this.paradexWs = null;
        this.stopParadexPing();

        // Auto-reconnect
        this.paradexReconnectTimeout = setTimeout(() => {
          this.connectToParadex();
        }, 5000);
      });

      ws.addEventListener('error', (error: any) => {
        console.error('Paradex WebSocket error:', error);
      });

      this.paradexWs = ws;
    } catch (error) {
      console.error('Failed to connect to Paradex:', error);
    }
  }

  subscribeParadexOrderbook(market: string) {
    if (this.paradexWs && this.paradexWs.readyState === WebSocket.OPEN) {
      const subscribeId = Date.now();
      this.paradexWs.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: {
          channel: `order_book.${market}.snapshot@15@50ms`
        },
        id: subscribeId
      }));
      console.log(`📚 Subscribed to Paradex order_book.${market}`);
    }
  }

  subscribeParadexTrades() {
    if (this.paradexWs && this.paradexWs.readyState === WebSocket.OPEN) {
      this.paradexWs.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: {
          channel: 'trades.ALL'
        },
        id: Date.now()
      }));
      console.log('📊 Subscribed to Paradex trades.ALL');
    }
  }

  startParadexPing() {
    this.stopParadexPing();
    this.paradexPingInterval = setInterval(() => {
      if (this.paradexWs && this.paradexWs.readyState === WebSocket.OPEN) {
        this.paradexWs.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'ping',
          id: Date.now()
        }));
      }
    }, 30000);
  }

  stopParadexPing() {
    if (this.paradexPingInterval) {
      clearInterval(this.paradexPingInterval);
      this.paradexPingInterval = null;
    }
  }

  async handleParadexMessage(data: string) {
    try {
      const message = JSON.parse(data);

      // Subscription confirmations
      if (message.result === 'ok') {
        return;
      }

      // Subscription data
      if (message.method === 'subscription' && message.params) {
        const { channel, data: channelData } = message.params;

        // Orderbook updates
        if (channel && channel.startsWith('order_book.')) {
          await this.saveParadexOrderbookUpdate(channelData);
        }

        // Trade updates
        if (channel === 'trades.ALL') {
          await this.saveParadexTrade(channelData);
        }
      }
    } catch (error) {
      console.error('Error parsing Paradex message:', error);
    }
  }

  async saveParadexOrderbookUpdate(data: any) {
    try {
      const { market, inserts, seq_no, last_updated_at } = data;
      if (!inserts || !Array.isArray(inserts)) return;

      const normalizedSymbol = this.getNormalizedSymbol('paradex', market);

      // Limit to 1 entry per side (best price only) to save memory
      const limitedInserts = inserts.slice(0, 1);

      if (limitedInserts.length > 0) {
        const values: string[] = [];
        const bindings: any[] = [];

        for (const entry of limitedInserts) {
          const side = entry.side === 'BUY' ? 'bid' : 'ask';
          values.push('(?, ?, ?, ?, ?, ?, ?, ?)');
          bindings.push(
            'paradex', market, normalizedSymbol, side,
            parseFloat(entry.price), parseFloat(entry.size),
            last_updated_at, seq_no
          );
        }

        // Batch insert
        const query = `INSERT INTO orderbook_entries
          (source, market_id, normalized_symbol, side, price, size, timestamp, seq_no)
          VALUES ${values.join(', ')}`;

        await this.env.DB.prepare(query).bind(...bindings).run();

        console.log(`📚 Paradex: Saved ${limitedInserts.length} entries for ${normalizedSymbol}`);
      }
    } catch (error) {
      console.error('Error saving Paradex orderbook:', error);
    }
  }

  async saveParadexTrade(data: any) {
    try {
      const { id, market, side, size, price, created_at, trade_type } = data;
      const normalizedSymbol = this.getNormalizedSymbol('paradex', market);

      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO paradex_trades
         (id, market, normalized_symbol, side, size, price, trade_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        market,
        normalizedSymbol,
        side,
        parseFloat(size),
        parseFloat(price),
        trade_type,
        created_at
      ).run();

      if (trade_type === 'RPI') {
        console.log(`💹 RPI Trade: ${normalizedSymbol} ${side} ${size} @ ${price}`);
      }
    } catch (error) {
      console.error('Error saving Paradex trade:', error);
    }
  }

  // ========== Data Cleanup ==========

  startPeriodicCleanup() {
    // Clean up old data every 30 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 30 * 60 * 1000); // 30 minutes

    // Also run cleanup immediately on start
    this.cleanupOldData();
  }

  async cleanupOldData() {
    try {
      const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000); // 30 minutes

      // Delete old orderbook entries
      const orderbookResult = await this.env.DB.prepare(
        `DELETE FROM orderbook_entries WHERE timestamp < ?`
      ).bind(thirtyMinutesAgo).run();

      // Delete old trades
      const tradesResult = await this.env.DB.prepare(
        `DELETE FROM paradex_trades WHERE created_at < ?`
      ).bind(thirtyMinutesAgo).run();

      console.log(`🧹 Cleanup: Removed ${orderbookResult.meta.changes || 0} old orderbook entries and ${tradesResult.meta.changes || 0} old trades (>30min)`);
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  // ========== Start/Stop Control ==========

  async startTracking() {
    if (this.isTracking) {
      console.log('⚠️ Tracking already running');
      return { success: false, message: 'Tracking already running' };
    }

    this.isTracking = true;
    await this.state.storage.put('isTracking', true);

    await this.initialize();

    console.log('▶️ Tracking started');
    this.broadcast({ type: 'tracking_status', data: { isTracking: true } });

    return { success: true, message: 'Tracking started' };
  }

  async stopTracking() {
    if (!this.isTracking) {
      console.log('⚠️ Tracking already stopped');
      return { success: false, message: 'Tracking already stopped' };
    }

    this.isTracking = false;
    await this.state.storage.put('isTracking', false);

    // Close WebSocket connections
    if (this.lighterWs) {
      this.lighterWs.close();
      this.lighterWs = null;
    }
    if (this.paradexWs) {
      this.paradexWs.close();
      this.paradexWs = null;
    }

    // Stop intervals
    this.stopLighterPing();
    this.stopParadexPing();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    console.log('⏸️ Tracking stopped');
    this.broadcast({ type: 'tracking_status', data: { isTracking: false } });

    return { success: true, message: 'Tracking stopped' };
  }

  // ========== Client WebSocket Handling ==========

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    await this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleSession(websocket: WebSocket) {
    websocket.accept();
    this.sessions.add(websocket);

    websocket.addEventListener('message', async (msg) => {
      try {
        const data = JSON.parse(msg.data as string);
        await this.handleClientMessage(data, websocket);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    websocket.addEventListener('close', () => {
      this.sessions.delete(websocket);
    });

    // Send current stats
    await this.sendStats(websocket);
  }

  async handleClientMessage(data: any, websocket: WebSocket) {
    switch (data.type) {
      case 'get_stats':
        await this.sendStats(websocket);
        break;

      case 'get_markets':
        await this.sendMarkets(websocket);
        break;

      case 'start_tracking':
        const startResult = await this.startTracking();
        websocket.send(JSON.stringify({
          type: 'tracking_control',
          data: startResult
        }));
        break;

      case 'stop_tracking':
        const stopResult = await this.stopTracking();
        websocket.send(JSON.stringify({
          type: 'tracking_control',
          data: stopResult
        }));
        break;
    }
  }

  async sendStats(websocket: WebSocket) {
    try {
      const stats = await this.env.DB.prepare(
        `SELECT
          source,
          COUNT(*) as total_entries,
          COUNT(DISTINCT normalized_symbol) as unique_symbols,
          MAX(timestamp) as last_update
         FROM orderbook_entries
         GROUP BY source`
      ).all();

      const tradeStats = await this.env.DB.prepare(
        `SELECT
          COUNT(*) as total_trades,
          COUNT(CASE WHEN trade_type = 'RPI' THEN 1 END) as rpi_trades,
          COUNT(CASE WHEN trade_type = 'FILL' THEN 1 END) as fill_trades
         FROM paradex_trades`
      ).first();

      websocket.send(JSON.stringify({
        type: 'stats',
        data: {
          orderbook: stats.results || [],
          trades: tradeStats,
          lighter_markets: this.lighterMarkets.size,
          paradex_markets: this.paradexMarkets.size,
          lighter_connected: this.lighterWs?.readyState === WebSocket.OPEN,
          paradex_connected: this.paradexWs?.readyState === WebSocket.OPEN,
          is_tracking: this.isTracking
        }
      }));
    } catch (error) {
      console.error('Error sending stats:', error);
    }
  }

  async sendMarkets(websocket: WebSocket) {
    websocket.send(JSON.stringify({
      type: 'markets',
      data: {
        lighter: Array.from(this.lighterMarkets),
        paradex: Array.from(this.paradexMarkets)
      }
    }));
  }

  broadcast(message: any) {
    const data = JSON.stringify(message);
    for (const session of this.sessions) {
      try {
        session.send(data);
      } catch (error) {
        console.error('Error broadcasting:', error);
      }
    }
  }
}

// Worker Handler mit HTTP-Endpoints
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

    // WebSocket-Verbindung
    if (url.pathname === '/ws') {
      const id = env.ORDERBOOK_TRACKER.idFromName('orderbook-tracker');
      const stub = env.ORDERBOOK_TRACKER.get(id);
      return stub.fetch(request);
    }

    // HTTP API: Orderbook-Daten abrufen
    if (url.pathname.startsWith('/api/orderbook/')) {
      const marketOrSymbol = url.pathname.replace('/api/orderbook/', '');

      // Query-Parameter
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? parseInt(limitParam) : null;
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const source = url.searchParams.get('source'); // 'lighter', 'paradex', oder null für beide
      const side = url.searchParams.get('side');
      let from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const timeframe = url.searchParams.get('timeframe');

      // Timeframe zu Timestamp konvertieren
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
        // Build Query dynamisch
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

        // Stats
        const statsResult = await env.DB.prepare(
          `SELECT
            source,
            COUNT(*) as total_entries,
            COUNT(CASE WHEN side = 'ask' THEN 1 END) as asks_count,
            COUNT(CASE WHEN side = 'bid' THEN 1 END) as bids_count,
            MAX(timestamp) as last_update,
            MIN(timestamp) as first_entry
           FROM orderbook_entries
           WHERE market_id = ? OR normalized_symbol = ?
           GROUP BY source`
        ).bind(marketOrSymbol, marketOrSymbol).all();

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
          },
          stats: statsResult.results || []
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Database error', details: String(error) }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // HTTP API: Paradex Trades abrufen
    if (url.pathname.startsWith('/api/trades/')) {
      const marketOrSymbol = url.pathname.replace('/api/trades/', '');

      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? parseInt(limitParam) : null;
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const tradeType = url.searchParams.get('type'); // 'RPI', 'FILL', oder null
      let from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const timeframe = url.searchParams.get('timeframe');

      // Timeframe zu Timestamp konvertieren
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
          },
          filters: {
            type: tradeType || 'all',
            timeframe: timeframe || null,
            from: from ? parseInt(from) : null,
            to: to ? parseInt(to) : null
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Database error', details: String(error) }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // HTTP API: Alle verfügbaren Markets
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

    // HTTP API: Token-Übersicht (Datenbankstatus pro Token)
    if (url.pathname === '/api/overview') {
      try {
        // Orderbook-Daten pro Token
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

        // Paradex Trades pro Token
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

        // Kombiniere die Daten
        const overview: any = {};

        // Orderbook-Daten einpflegen
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

        // Trade-Daten einpflegen
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

        // In Array umwandeln
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
        return new Response(JSON.stringify({ error: 'Database error', details: String(error) }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Frontend: Dashboard
    if (url.pathname === '/dashboard' || url.pathname === '/dashboard.html') {
      return new Response(DASHBOARD_HTML, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8'
        }
      });
    }

    // Frontend: Main Page
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

// Type Definitions
interface TokenMapping {
  source: string;
  original_symbol: string;
  normalized_symbol: string;
  base_asset: string | null;
  quote_asset: string | null;
  market_type: string | null;
  active: number;
}
