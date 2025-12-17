/**
 * Main Worker - Clean Implementation
 * Koordiniert Lighter Tracker und bietet API/Frontend
 */

import { LighterTracker } from './lighter-new';
import { ParadexTracker } from './paradex-new';
import { HyperliquidTracker } from './hyperliquid-new';
import { ArbitrageCalculator } from './arbitrage';
import { AlertManager } from './alert-manager';

export { LighterTracker, ParadexTracker, HyperliquidTracker, AlertManager };

export interface Env {
  LIGHTER_TRACKER: DurableObjectNamespace;
  PARADEX_TRACKER: DurableObjectNamespace;
  HYPERLIQUID_TRACKER: DurableObjectNamespace;
  ALERT_MANAGER: DurableObjectNamespace;
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
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

    // Lighter WebSocket
    if (url.pathname === '/ws/lighter' || url.pathname === '/ws') {
      const id = env.LIGHTER_TRACKER.idFromName('lighter-tracker');
      const tracker = env.LIGHTER_TRACKER.get(id);
      return tracker.fetch(request);
    }

    // Paradex WebSocket
    if (url.pathname === '/ws/paradex') {
      const id = env.PARADEX_TRACKER.idFromName('paradex-tracker');
      const tracker = env.PARADEX_TRACKER.get(id);
      return tracker.fetch(request);
    }

    // Hyperliquid WebSocket
    if (url.pathname === '/ws/hyperliquid') {
      const id = env.HYPERLIQUID_TRACKER.idFromName('hyperliquid-tracker');
      const tracker = env.HYPERLIQUID_TRACKER.get(id);
      return tracker.fetch(request);
    }

    //=====================================
    // Lighter API Endpoints
    //=====================================

    // GET /api/lighter/stats - Lighter Statistics
    if (url.pathname === '/api/lighter/stats' || url.pathname === '/api/stats') {
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

    // GET /api/lighter/markets - All Lighter Markets
    if (url.pathname === '/api/lighter/markets' || url.pathname === '/api/markets') {
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

    // GET /api/lighter/snapshots?symbol=ETH&limit=100
    if (url.pathname === '/api/lighter/snapshots' || url.pathname === '/api/snapshots') {
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

    // GET /api/lighter/minutes?symbol=ETH&limit=60
    if (url.pathname === '/api/lighter/minutes' || url.pathname === '/api/minutes') {
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

    // GET /api/lighter/overview - Lighter Data Overview
    if (url.pathname === '/api/lighter/overview' || url.pathname === '/api/overview') {
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
    // Paradex API Endpoints
    //=====================================

    // GET /api/paradex/stats - Paradex Statistics
    if (url.pathname === '/api/paradex/stats') {
      try {
        const id = env.PARADEX_TRACKER.idFromName('paradex-tracker');
        const tracker = env.PARADEX_TRACKER.get(id);
        const response = await tracker.fetch(request);
        return response;
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to fetch stats' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/paradex/markets - All Paradex Markets
    if (url.pathname === '/api/paradex/markets') {
      try {
        const result = await env.DB.prepare(
          `SELECT * FROM paradex_markets WHERE active = 1 ORDER BY symbol`
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

    // GET /api/paradex/snapshots?symbol=BTC&limit=100
    if (url.pathname === '/api/paradex/snapshots') {
      try {
        const symbol = url.searchParams.get('symbol');
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        let query = 'SELECT * FROM paradex_snapshots';
        const params: any[] = [];

        if (symbol) {
          query += ' WHERE symbol = ?';
          params.push(symbol);
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const result = await env.DB.prepare(query).bind(...params).all();

        return new Response(JSON.stringify({
          symbol: symbol || 'all',
          data: result.results || [],
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

    // GET /api/paradex/minutes?symbol=BTC&limit=60
    if (url.pathname === '/api/paradex/minutes') {
      try {
        const symbol = url.searchParams.get('symbol');
        const limit = parseInt(url.searchParams.get('limit') || '60');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const from = url.searchParams.get('from'); // timestamp
        const to = url.searchParams.get('to');

        let query = 'SELECT * FROM paradex_minutes';
        const params: any[] = [];
        const conditions: string[] = [];

        if (symbol) {
          conditions.push('symbol = ?');
          params.push(symbol);
        }

        if (from) {
          conditions.push('timestamp >= ?');
          params.push(parseInt(from));
        }

        if (to) {
          conditions.push('timestamp <= ?');
          params.push(parseInt(to));
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const result = await env.DB.prepare(query).bind(...params).all();

        return new Response(JSON.stringify({
          symbol: symbol || 'all',
          data: result.results || [],
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

    // GET /api/paradex/overview - Paradex Data Overview
    if (url.pathname === '/api/paradex/overview') {
      try {
        const symbolStats = await env.DB.prepare(`
          SELECT symbol,
                 COUNT(*) as total_minutes,
                 MIN(timestamp) as first_minute,
                 MAX(timestamp) as last_minute,
                 AVG(avg_bid) as overall_avg_bid,
                 AVG(avg_ask) as overall_avg_ask,
                 SUM(tick_count) as total_ticks
          FROM paradex_minutes
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
    // Hyperliquid API Endpoints
    //=====================================

    // GET /api/hyperliquid/stats - Hyperliquid Statistics
    if (url.pathname === '/api/hyperliquid/stats') {
      try {
        const id = env.HYPERLIQUID_TRACKER.idFromName('hyperliquid-tracker');
        const tracker = env.HYPERLIQUID_TRACKER.get(id);

        // Forward request to tracker with correct path
        const statsResponse = await tracker.fetch(new Request('http://internal/stats'));
        const stats = await statsResponse.json();

        return new Response(JSON.stringify(stats), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to fetch stats' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/hyperliquid/markets - All Hyperliquid Markets
    if (url.pathname === '/api/hyperliquid/markets') {
      try {
        const result = await env.DB.prepare(
          `SELECT * FROM hyperliquid_markets WHERE active = 1 ORDER BY symbol`
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

    // GET /api/hyperliquid/snapshots?symbol=BTC&limit=100
    if (url.pathname === '/api/hyperliquid/snapshots') {
      try {
        const symbol = url.searchParams.get('symbol');
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        let query = 'SELECT * FROM hyperliquid_snapshots';
        const params: any[] = [];

        if (symbol) {
          query += ' WHERE symbol = ?';
          params.push(symbol);
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const result = await env.DB.prepare(query).bind(...params).all();

        return new Response(JSON.stringify({
          symbol: symbol || 'all',
          data: result.results || [],
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

    // GET /api/hyperliquid/minutes?symbol=BTC&limit=60
    if (url.pathname === '/api/hyperliquid/minutes') {
      try {
        const symbol = url.searchParams.get('symbol');
        const limit = parseInt(url.searchParams.get('limit') || '60');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const from = url.searchParams.get('from'); // timestamp
        const to = url.searchParams.get('to');

        let query = 'SELECT * FROM hyperliquid_minutes';
        const params: any[] = [];
        const conditions: string[] = [];

        if (symbol) {
          conditions.push('symbol = ?');
          params.push(symbol);
        }

        if (from) {
          conditions.push('timestamp >= ?');
          params.push(parseInt(from));
        }

        if (to) {
          conditions.push('timestamp <= ?');
          params.push(parseInt(to));
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const result = await env.DB.prepare(query).bind(...params).all();

        return new Response(JSON.stringify({
          symbol: symbol || 'all',
          data: result.results || [],
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

    // GET /api/hyperliquid/overview - Hyperliquid Data Overview
    if (url.pathname === '/api/hyperliquid/overview') {
      try {
        const symbolStats = await env.DB.prepare(`
          SELECT symbol,
                 COUNT(*) as total_minutes,
                 MIN(timestamp) as first_minute,
                 MAX(timestamp) as last_minute,
                 AVG(avg_bid) as overall_avg_bid,
                 AVG(avg_ask) as overall_avg_ask,
                 SUM(tick_count) as total_ticks
          FROM hyperliquid_minutes
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
    // Arbitrage API Endpoints
    //=====================================

    // GET /api/arbitrage - Calculate arbitrage opportunities
    // Query params:
    //   - symbol: Filter by symbol (e.g., 'BTC', 'ETH')
    //   - exchanges: Comma-separated list (default: 'lighter,paradex,hyperliquid')
    //   - minProfit: Minimum profit percentage (default: 0)
    //   - useMinutes: Use minute data instead of snapshots (default: false)
    if (url.pathname === '/api/arbitrage') {
      try {
        const calculator = new ArbitrageCalculator(env.DB);

        const symbol = url.searchParams.get('symbol') || undefined;
        const exchangesParam = url.searchParams.get('exchanges') || 'lighter,paradex,hyperliquid';
        const exchanges = exchangesParam.split(',').map(e => e.trim());
        const minProfit = parseFloat(url.searchParams.get('minProfit') || '0');
        const useMinutes = url.searchParams.get('useMinutes') === 'true';

        const opportunities = await calculator.calculate(
          exchanges,
          symbol,
          minProfit,
          useMinutes
        );

        return new Response(JSON.stringify({
          opportunities,
          count: opportunities.length,
          filters: {
            symbol: symbol || 'all',
            exchanges,
            minProfit,
            source: useMinutes ? 'minutes' : 'snapshots'
          },
          timestamp: Date.now()
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (error: any) {
        return new Response(JSON.stringify({
          error: error.message || 'Failed to calculate arbitrage'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/arbitrage/history - Historical arbitrage opportunities
    // Query params:
    //   - symbol: Symbol to analyze (required)
    //   - exchanges: Comma-separated list (default: 'lighter,paradex,hyperliquid')
    //   - from: Start timestamp (required)
    //   - to: End timestamp (required)
    //   - interval: 'snapshots' or 'minutes' (default: 'minutes')
    if (url.pathname === '/api/arbitrage/history') {
      try {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) {
          return new Response(JSON.stringify({
            error: 'Parameter "symbol" is required'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        if (!from || !to) {
          return new Response(JSON.stringify({
            error: 'Parameters "from" and "to" timestamps are required'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const calculator = new ArbitrageCalculator(env.DB);
        const exchangesParam = url.searchParams.get('exchanges') || 'lighter,paradex,hyperliquid';
        const exchanges = exchangesParam.split(',').map(e => e.trim());
        const interval = (url.searchParams.get('interval') || 'minutes') as 'snapshots' | 'minutes';

        const opportunities = await calculator.getHistoricalArbitrage(
          exchanges,
          symbol,
          parseInt(from),
          parseInt(to),
          interval
        );

        return new Response(JSON.stringify({
          opportunities,
          count: opportunities.length,
          filters: {
            symbol,
            exchanges,
            from: parseInt(from),
            to: parseInt(to),
            interval
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (error: any) {
        return new Response(JSON.stringify({
          error: error.message || 'Failed to get historical arbitrage'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    //=====================================
    // Alert Manager API Endpoints
    //=====================================

    // All /api/alerts/* requests are forwarded to AlertManager DO
    if (url.pathname.startsWith('/api/alerts')) {
      try {
        const id = env.ALERT_MANAGER.idFromName('alert-manager');
        const manager = env.ALERT_MANAGER.get(id);

        // Forward request to AlertManager
        const alertRequest = new Request(
          `http://internal${url.pathname.replace('/api/alerts', '')}${url.search}`,
          {
            method: request.method,
            headers: request.headers,
            body: request.body
          }
        );

        return manager.fetch(alertRequest);
      } catch (error: any) {
        return new Response(JSON.stringify({
          error: error.message || 'Failed to communicate with AlertManager'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    //=====================================
    // Frontend
    //=====================================

    // Overview Page (default)
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/overview') {
      return new Response(OVERVIEW_HTML, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Lighter Dashboard
    if (url.pathname === '/lighter' || url.pathname === '/lighter.html') {
      return new Response(LIGHTER_DASHBOARD, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Paradex Dashboard
    if (url.pathname === '/paradex' || url.pathname === '/paradex.html') {
      return new Response(PARADEX_DASHBOARD, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Hyperliquid Dashboard
    if (url.pathname === '/hyperliquid' || url.pathname === '/hyperliquid.html') {
      return new Response(HYPERLIQUID_DASHBOARD, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },

  /**
   * Scheduled handler for Cron Triggers
   * Runs periodically to check for arbitrage alerts
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('[Cron] 🕐 Scheduled task triggered:', event.cron);

    try {
      // Initialize and check alerts via AlertManager
      const id = env.ALERT_MANAGER.idFromName('alert-manager');
      const manager = env.ALERT_MANAGER.get(id);

      // Trigger alert check
      const response = await manager.fetch(new Request('http://internal/check', {
        method: 'POST'
      }));

      const result = await response.json();
      console.log('[Cron] ✅ Alert check completed:', result);

    } catch (error) {
      console.error('[Cron] ❌ Alert check failed:', error);
    }
  }
};

//=====================================
// Frontend HTML - Lighter
//=====================================

const LIGHTER_DASHBOARD = `<!DOCTYPE html>
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
    .nav { margin-bottom: 20px; }
    .nav a { color: #8b92a8; margin-right: 20px; text-decoration: none; }
    .nav a:hover { color: #00ff88; }
    .nav a.active { color: #00ff88; font-weight: bold; }
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
    <div class="nav">
      <a href="/overview">Overview</a>
      <a href="/lighter" class="active">Lighter</a>
      <a href="/paradex">Paradex</a>
    </div>
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
      log('Connecting to Lighter WebSocket...');
      ws = new WebSocket(WS_URL + window.location.host + '/ws/lighter');

      ws.onopen = () => {
        log('✅ Connected to Dashboard');
        dashboardConnected = true;
        ws.send(JSON.stringify({ type: 'get_stats' }));
        startStatsInterval();
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      };

      ws.onclose = () => {
        log('❌ Disconnected from Dashboard');
        dashboardConnected = false;
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
    let dashboardConnected = false;

    function updateStatus(isTracking, lighterConnected) {
      const statusEl = document.getElementById('status');
      const startBtn = document.getElementById('startBtn');
      const stopBtn = document.getElementById('stopBtn');

      if (isTracking) {
        statusEl.textContent = '🟢 TRACKING';
        statusEl.className = 'status running';
        startBtn.disabled = true;
        stopBtn.disabled = false;
      } else {
        if (lighterConnected) {
          statusEl.textContent = '🟢 READY';
        } else {
          statusEl.textContent = dashboardConnected ? '🔴 STOPPED' : '⚠️ DISCONNECTED';
        }
        statusEl.className = 'status stopped';
        // Button ist enabled wenn Dashboard verbunden ist (nicht Lighter!)
        startBtn.disabled = !dashboardConnected;
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

//=====================================
// Frontend HTML - Paradex
//=====================================

const PARADEX_DASHBOARD = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paradex Orderbook Tracker</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #0a0b0d;
      color: #00d4ff;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .nav { margin-bottom: 20px; }
    .nav a { color: #8b92a8; margin-right: 20px; text-decoration: none; }
    .nav a:hover { color: #00d4ff; }
    .nav a.active { color: #00d4ff; font-weight: bold; }
    h1 {
      font-size: 32px;
      margin-bottom: 10px;
      text-shadow: 0 0 10px #00d4ff;
    }
    .subtitle {
      color: #8b92a8;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .control-panel {
      background: #1a1c26;
      border: 1px solid #00d4ff;
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
    .status.running { background: rgba(0, 212, 255, 0.2); color: #00d4ff; }
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
      background: #00d4ff;
      color: #0a0b0d;
    }
    .btn-start:hover:not(:disabled) {
      background: #00a8cc;
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
      border-left: 3px solid #00d4ff;
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
  </style>
</head>
<body>
  <div class="container">
    <div class="nav">
      <a href="/lighter">Lighter</a>
      <a href="/paradex" class="active">Paradex</a>
      <a href="/overview">Overview</a>
    </div>

    <h1>🔷 PARADEX ORDERBOOK TRACKER</h1>
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
    let dashboardConnected = false;

    function connect() {
      log('Connecting to Paradex WebSocket...');
      ws = new WebSocket(WS_URL + window.location.host + '/ws/paradex');

      ws.onopen = () => {
        log('✅ Connected to Dashboard');
        dashboardConnected = true;
        ws.send(JSON.stringify({ type: 'get_stats' }));
        setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'get_stats' }));
          }
        }, 5000);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stats') {
          updateStats(msg.data);
        } else if (msg.type === 'control') {
          log(msg.data.message);
          ws.send(JSON.stringify({ type: 'get_stats' }));
        } else if (msg.type === 'status') {
          log(msg.data.isTracking ? '▶️ Tracking started' : '⏸️ Tracking stopped');
          updateStatus(msg.data.isTracking, true);
        }
      };

      ws.onclose = () => {
        log('❌ Disconnected from Dashboard');
        dashboardConnected = false;
        updateStatus(false, false);
        setTimeout(connect, 5000);
      };
    }

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

    function updateStatus(isTracking, paradexConnected) {
      const statusEl = document.getElementById('status');
      const startBtn = document.getElementById('startBtn');
      const stopBtn = document.getElementById('stopBtn');

      if (isTracking) {
        statusEl.textContent = '🟢 TRACKING';
        statusEl.className = 'status running';
        startBtn.disabled = true;
        stopBtn.disabled = false;
      } else {
        if (paradexConnected) {
          statusEl.textContent = '🟢 READY';
        } else {
          statusEl.textContent = dashboardConnected ? '🔴 STOPPED' : '⚠️ DISCONNECTED';
        }
        statusEl.className = 'status stopped';
        startBtn.disabled = !dashboardConnected;
        stopBtn.disabled = true;
      }
    }

    document.getElementById('startBtn').addEventListener('click', () => {
      log('▶️ Starting tracking...');
      ws.send(JSON.stringify({ type: 'start_tracking' }));
    });

    document.getElementById('stopBtn').addEventListener('click', () => {
      log('⏸️ Stopping tracking...');
      ws.send(JSON.stringify({ type: 'stop_tracking' }));
    });

    function log(message) {
      const logPanel = document.getElementById('logPanel');
      const time = new Date().toLocaleTimeString();
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = '<span class="log-time">[' + time + ']</span> ' + message;
      logPanel.insertBefore(entry, logPanel.firstChild);
      while (logPanel.children.length > 50) {
        logPanel.removeChild(logPanel.lastChild);
      }
    }

    connect();
  </script>
</body>
</html>`;

//=====================================
// Overview Page
//=====================================

const OVERVIEW_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exchange Overview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #0a0b0d;
      color: #ffffff;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .nav { margin-bottom: 20px; }
    .nav a { color: #8b92a8; margin-right: 20px; text-decoration: none; }
    .nav a:hover { color: #00ff88; }
    .nav a.active { color: #00ff88; font-weight: bold; }
    h1 {
      font-size: 32px;
      margin-bottom: 30px;
      text-align: center;
      background: linear-gradient(135deg, #00ff88, #00d4ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .exchange-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 20px;
    }
    .exchange-card {
      background: #1a1c26;
      border-radius: 12px;
      padding: 24px;
    }
    .exchange-card.lighter { border-left: 4px solid #00ff88; }
    .exchange-card.paradex { border-left: 4px solid #00d4ff; }
    .exchange-card h2 {
      font-size: 24px;
      margin-bottom: 20px;
    }
    .exchange-card.lighter h2 { color: #00ff88; }
    .exchange-card.paradex h2 { color: #00d4ff; }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #2a2d3a;
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: #8b92a8; }
    .stat-value { font-weight: bold; }
    .btn {
      display: inline-block;
      margin-top: 20px;
      padding: 12px 24px;
      border: none;
      border-radius: 6px;
      font-family: inherit;
      font-size: 14px;
      font-weight: bold;
      text-decoration: none;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-lighter {
      background: #00ff88;
      color: #0a0b0d;
    }
    .btn-paradex {
      background: #00d4ff;
      color: #0a0b0d;
    }
    .btn:hover {
      transform: translateY(-2px);
      filter: brightness(1.1);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="nav">
      <a href="/lighter">Lighter</a>
      <a href="/paradex">Paradex</a>
      <a href="/overview" class="active">Overview</a>
    </div>

    <h1>📊 EXCHANGE OVERVIEW</h1>

    <div class="exchange-grid">
      <!-- Lighter Card -->
      <div class="exchange-card lighter">
        <h2>⚡ Lighter</h2>
        <div class="stat-row">
          <span class="stat-label">Status</span>
          <span class="stat-value" id="lighterStatus">Loading...</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Markets</span>
          <span class="stat-value" id="lighterMarkets">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Messages</span>
          <span class="stat-value" id="lighterMessages">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Snapshots</span>
          <span class="stat-value" id="lighterSnapshots">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Minutes</span>
          <span class="stat-value" id="lighterMinutes">-</span>
        </div>
        <a href="/lighter" class="btn btn-lighter">Open Dashboard →</a>
      </div>

      <!-- Paradex Card -->
      <div class="exchange-card paradex">
        <h2>🔷 Paradex</h2>
        <div class="stat-row">
          <span class="stat-label">Status</span>
          <span class="stat-value" id="paradexStatus">Loading...</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Markets</span>
          <span class="stat-value" id="paradexMarkets">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Messages</span>
          <span class="stat-value" id="paradexMessages">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Snapshots</span>
          <span class="stat-value" id="paradexSnapshots">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Minutes</span>
          <span class="stat-value" id="paradexMinutes">-</span>
        </div>
        <a href="/paradex" class="btn btn-paradex">Open Dashboard →</a>
      </div>
    </div>
  </div>

  <script>
    async function loadStats() {
      // Lighter stats via WebSocket
      const lighterWs = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/lighter');
      lighterWs.onopen = () => lighterWs.send(JSON.stringify({ type: 'get_stats' }));
      lighterWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'stats') {
          updateLighterStats(msg.data);
          lighterWs.close();
        }
      };

      // Paradex stats via WebSocket
      const paradexWs = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/paradex');
      paradexWs.onopen = () => paradexWs.send(JSON.stringify({ type: 'get_stats' }));
      paradexWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'stats') {
          updateParadexStats(msg.data);
          paradexWs.close();
        }
      };
    }

    function updateLighterStats(data) {
      document.getElementById('lighterStatus').textContent = data.isTracking ? '🟢 Tracking' : '🔴 Stopped';
      document.getElementById('lighterMarkets').textContent = data.markets || 0;
      document.getElementById('lighterMessages').textContent = (data.messagesReceived || 0).toLocaleString();
      document.getElementById('lighterSnapshots').textContent = data.database?.snapshots || 0;
      document.getElementById('lighterMinutes').textContent = data.database?.minutes || 0;
    }

    function updateParadexStats(data) {
      document.getElementById('paradexStatus').textContent = data.isTracking ? '🟢 Tracking' : '🔴 Stopped';
      document.getElementById('paradexMarkets').textContent = data.markets || 0;
      document.getElementById('paradexMessages').textContent = (data.messagesReceived || 0).toLocaleString();
      document.getElementById('paradexSnapshots').textContent = data.database?.snapshots || 0;
      document.getElementById('paradexMinutes').textContent = data.database?.minutes || 0;
    }

    loadStats();
    setInterval(loadStats, 10000); // Refresh every 10s
  </script>
</body>
</html>`;

const HYPERLIQUID_DASHBOARD = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hyperliquid Tracker - Orderbook Monitor</title>
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
      --accent-orange: #ff9500;
      --text-primary: #ffffff;
      --text-secondary: #8b92a8;
      --border: #2a2d3a;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'JetBrains Mono', monospace;
      background: var(--bg-primary);
      color: var(--text-primary);
      padding: 20px;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      margin-bottom: 40px;
    }

    h1 {
      font-family: 'Syne', sans-serif;
      font-size: 48px;
      font-weight: 800;
      background: linear-gradient(135deg, var(--accent-orange), var(--accent-blue));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 8px;
    }

    .subtitle {
      font-size: 14px;
      color: var(--text-secondary);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      transition: all 0.3s ease;
    }

    .stat-card:hover {
      border-color: var(--accent-orange);
      transform: translateY(-2px);
    }

    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    .stat-value {
      font-size: 32px;
      font-weight: 800;
      font-family: 'Syne', sans-serif;
      color: var(--accent-orange);
    }

    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .status-active {
      background: rgba(0, 255, 136, 0.15);
      color: var(--accent-green);
      border: 1px solid rgba(0, 255, 136, 0.3);
    }

    .status-inactive {
      background: rgba(139, 146, 168, 0.15);
      color: var(--text-secondary);
      border: 1px solid var(--border);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .controls {
      display: flex;
      gap: 12px;
      margin-bottom: 30px;
      justify-content: center;
    }

    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .btn-primary {
      background: var(--accent-green);
      color: var(--bg-primary);
    }

    .btn-primary:hover {
      background: #00dd77;
      transform: translateY(-2px);
    }

    .btn-danger {
      background: var(--accent-red);
      color: var(--text-primary);
    }

    .btn-danger:hover {
      background: #ee2255;
      transform: translateY(-2px);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .markets-section {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
    }

    .section-title {
      font-family: 'Syne', sans-serif;
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 20px;
      color: var(--accent-orange);
    }

    .markets-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 12px;
      max-height: 400px;
      overflow-y: auto;
    }

    .market-badge {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      text-align: center;
      font-size: 12px;
      font-weight: 600;
      color: var(--accent-orange);
      transition: all 0.2s ease;
    }

    .market-badge:hover {
      background: var(--bg-primary);
      border-color: var(--accent-orange);
    }

    .log {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      max-height: 400px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.8;
    }

    .log-entry {
      padding: 4px 0;
      border-bottom: 1px solid rgba(42, 45, 58, 0.3);
    }

    .log-time {
      color: var(--text-secondary);
      margin-right: 12px;
    }

    .log-message {
      color: var(--text-primary);
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }

    .loading {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid var(--border);
      border-top-color: var(--accent-orange);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🟠 HYPERLIQUID TRACKER</h1>
      <p class="subtitle">Real-time Orderbook Monitoring für Hyperliquid DEX</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Status</div>
        <div id="statusIndicator" class="status-indicator status-inactive">
          <span class="status-dot"></span>
          <span>Offline</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Markets</div>
        <div class="stat-value" id="marketCount">-</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Messages Received</div>
        <div class="stat-value" id="messagesReceived">-</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Snapshots</div>
        <div class="stat-value" id="snapshotCount">-</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Minutes Aggregated</div>
        <div class="stat-value" id="minuteCount">-</div>
      </div>
    </div>

    <div class="controls">
      <button id="startBtn" class="btn btn-primary" onclick="startTracking()">
        ▶ Start Tracking
      </button>
      <button id="stopBtn" class="btn btn-danger" onclick="stopTracking()" disabled>
        ⏸ Stop Tracking
      </button>
      <button class="btn" onclick="loadStats()" style="background: var(--bg-secondary); color: var(--text-primary);">
        🔄 Refresh
      </button>
    </div>

    <div class="markets-section">
      <div class="section-title">📊 Tracked Markets</div>
      <div id="marketsContainer">
        <div class="empty-state">
          <div class="loading"></div>
          <p style="margin-top: 16px;">Loading markets...</p>
        </div>
      </div>
    </div>

    <div class="markets-section">
      <div class="section-title">📝 Activity Log</div>
      <div id="logContainer" class="log">
        <div class="log-entry">
          <span class="log-time">[--:--:--]</span>
          <span class="log-message">Waiting for connection...</span>
        </div>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = window.location.origin;
    const WS_URL = window.location.origin.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws/hyperliquid';

    let ws = null;
    let reconnectTimer = null;

    loadStats();
    loadMarkets();
    setInterval(loadStats, 30000);

    async function loadStats() {
      try {
        const response = await fetch(\`\${API_BASE}/api/hyperliquid/stats\`);
        const stats = await response.json();
        updateStats(stats);
        log('✅ Stats refreshed');
      } catch (error) {
        log(\`❌ Failed to load stats: \${error.message}\`);
      }
    }

    async function loadMarkets() {
      try {
        const response = await fetch(\`\${API_BASE}/api/hyperliquid/markets\`);
        const data = await response.json();
        renderMarkets(data.markets || []);
        log(\`📊 Loaded \${data.count || 0} markets\`);
      } catch (error) {
        log(\`❌ Failed to load markets: \${error.message}\`);
        document.getElementById('marketsContainer').innerHTML = \`
          <div class="empty-state">
            <p style="color: var(--accent-red);">❌ Error loading markets</p>
          </div>
        \`;
      }
    }

    function updateStats(stats) {
      document.getElementById('marketCount').textContent = stats.markets || 0;
      document.getElementById('messagesReceived').textContent = (stats.messagesReceived || 0).toLocaleString();
      document.getElementById('snapshotCount').textContent = (stats.database?.snapshots || 0).toLocaleString();
      document.getElementById('minuteCount').textContent = (stats.database?.minutes || 0).toLocaleString();

      const statusEl = document.getElementById('statusIndicator');
      if (stats.isTracking) {
        statusEl.className = 'status-indicator status-active';
        statusEl.innerHTML = '<span class="status-dot"></span><span>Active</span>';
        document.getElementById('startBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
      } else {
        statusEl.className = 'status-indicator status-inactive';
        statusEl.innerHTML = '<span class="status-dot"></span><span>Offline</span>';
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
      }
    }

    function renderMarkets(markets) {
      const container = document.getElementById('marketsContainer');

      if (!markets || markets.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <p>📭 No markets found</p>
            <p style="font-size: 12px; margin-top: 8px; opacity: 0.6;">
              Start tracking to load markets
            </p>
          </div>
        \`;
        return;
      }

      container.innerHTML = \`
        <div class="markets-grid">
          \${markets.map(m => \`<div class="market-badge">\${m.symbol}</div>\`).join('')}
        </div>
      \`;
    }

    function connectWebSocket() {
      if (ws) return;

      log('🔌 Connecting to WebSocket...');
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        log('✅ WebSocket connected');
        ws.send(JSON.stringify({ type: 'get_stats' }));
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);

        if (message.type === 'stats') {
          updateStats(message.data);
        } else if (message.type === 'status') {
          log(\`📊 Status update: \${JSON.stringify(message.data)}\`);
          loadStats();
        } else if (message.type === 'control') {
          log(\`🎛️ Control response: \${message.data.message}\`);
          loadStats();
          if (message.data.success) {
            loadMarkets();
          }
        }
      };

      ws.onclose = () => {
        log('🔌 WebSocket disconnected');
        ws = null;
        scheduleReconnect();
      };

      ws.onerror = (error) => {
        log('❌ WebSocket error');
      };
    }

    function scheduleReconnect() {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        log('🔄 Reconnecting...');
        connectWebSocket();
      }, 5000);
    }

    function startTracking() {
      connectWebSocket();
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          log('▶ Starting tracker...');
          ws.send(JSON.stringify({ type: 'start_tracking' }));
        }
      }, 1000);
    }

    function stopTracking() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        log('⏸ Stopping tracker...');
        ws.send(JSON.stringify({ type: 'stop_tracking' }));
      }
    }

    function log(message) {
      const container = document.getElementById('logContainer');
      const time = new Date().toLocaleTimeString('de-DE');

      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = \`
        <span class="log-time">[\${time}]</span>
        <span class="log-message">\${message}</span>
      \`;

      container.insertBefore(entry, container.firstChild);

      while (container.children.length > 50) {
        container.removeChild(container.lastChild);
      }
    }

    setTimeout(connectWebSocket, 1000);
  </script>
</body>
</html>`;
