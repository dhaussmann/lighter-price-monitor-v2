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
    const cleanupId = env.LIGHTER_TRACKER.idFromName('cleanup-manager');
    const cleanup = env.LIGHTER_TRACKER.get(cleanupId);

    // Start/Stop tracking endpoints
    if (url.pathname === '/api/control/start') {
      const exchange = url.searchParams.get('exchange');

      if (exchange === 'lighter' || !exchange) {
        const id = env.LIGHTER_TRACKER.idFromName('lighter-tracker');
        const tracker = env.LIGHTER_TRACKER.get(id);
        const ws = new WebSocket(WS_URL);
        // Send start message via WebSocket
      }

      if (exchange === 'paradex' || !exchange) {
        const id = env.PARADEX_TRACKER.idFromName('paradex-tracker');
        const tracker = env.PARADEX_TRACKER.get(id);
        // Send start message via WebSocket
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
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
  <title>Dashboard - Multi-DO Tracker</title>
  <style>
    body { font-family: monospace; background: #0a0b0d; color: white; padding: 20px; }
    h1 { color: #00ff88; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; background: #1a1c26; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #2a2d3a; }
    th { background: #13141a; color: #8b92a8; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; }
    .badge-lighter { background: rgba(0, 255, 136, 0.2); color: #00ff88; }
    .badge-paradex { background: rgba(0, 212, 255, 0.2); color: #00d4ff; }
  </style>
</head>
<body>
  <h1>📊 DATABASE OVERVIEW</h1>
  <div id="data">Loading...</div>
  <script>
    async function loadData() {
      const response = await fetch('/api/overview');
      const data = await response.json();

      let html = '<table><thead><tr><th>Token</th><th>Sources</th><th>Lighter</th><th>Paradex</th><th>Trades</th></tr></thead><tbody>';

      for (const token of data.tokens) {
        const lighter = token.sources.lighter || {};
        const paradex = token.sources.paradex || {};
        const trades = token.trades || {};

        html += '<tr>';
        html += '<td><strong>' + token.symbol + '</strong></td>';
        html += '<td>';
        if (lighter.total_entries) html += '<span class="badge badge-lighter">Lighter</span> ';
        if (paradex.total_entries) html += '<span class="badge badge-paradex">Paradex</span>';
        html += '</td>';
        html += '<td>' + (lighter.total_entries || '-') + '</td>';
        html += '<td>' + (paradex.total_entries || '-') + '</td>';
        html += '<td>' + (trades.total_trades || '-') + '</td>';
        html += '</tr>';
      }

      html += '</tbody></table>';
      document.getElementById('data').innerHTML = html;
    }

    loadData();
    setInterval(loadData, 30000);
  </script>
</body>
</html>`;
