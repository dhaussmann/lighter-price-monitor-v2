/**
 * Main Worker - Clean Implementation
 * Koordiniert Lighter Tracker und bietet API/Frontend
 */

import { LighterTracker } from './lighter-new';
import { ParadexTracker } from './paradex-new';
import { HyperliquidTracker } from './hyperliquid-new';
import { EdgeXTracker } from './edgex-new';
import { ArbitrageCalculator } from './arbitrage';
import { AlertManager } from './alert-manager';

export { LighterTracker, ParadexTracker, HyperliquidTracker, EdgeXTracker, AlertManager };

export interface Env {
  LIGHTER_TRACKER: DurableObjectNamespace;
  PARADEX_TRACKER: DurableObjectNamespace;
  HYPERLIQUID_TRACKER: DurableObjectNamespace;
  EDGEX_TRACKER: DurableObjectNamespace;
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

    // EdgeX WebSocket
    if (url.pathname === '/ws/edgex') {
      const id = env.EDGEX_TRACKER.idFromName('edgex-tracker');
      const tracker = env.EDGEX_TRACKER.get(id);
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
    // EdgeX API Endpoints
    //=====================================

    // GET /api/edgex/stats - EdgeX Statistics
    if (url.pathname === '/api/edgex/stats') {
      try {
        const id = env.EDGEX_TRACKER.idFromName('edgex-tracker');
        const tracker = env.EDGEX_TRACKER.get(id);

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

    // GET /api/edgex/markets - All EdgeX Markets
    if (url.pathname === '/api/edgex/markets') {
      try {
        const result = await env.DB.prepare(
          `SELECT * FROM edgex_markets ORDER BY contract_name`
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

    // GET /api/edgex/snapshots?contract=BTCUSD&limit=100
    if (url.pathname === '/api/edgex/snapshots') {
      try {
        const contract = url.searchParams.get('contract');
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        let query = 'SELECT * FROM orderbook_snapshots WHERE source = ?';
        const params: any[] = ['edgex'];

        if (contract) {
          query += ' AND symbol = ?';
          params.push(contract);
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const result = await env.DB.prepare(query).bind(...params).all();

        return new Response(JSON.stringify({
          contract: contract || 'all',
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

    // GET /api/edgex/minutes?contract=BTCUSD&limit=60
    if (url.pathname === '/api/edgex/minutes') {
      try {
        const contract = url.searchParams.get('contract');
        const limit = parseInt(url.searchParams.get('limit') || '60');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');

        let query = 'SELECT * FROM orderbook_minutes';
        const params: any[] = [];
        const conditions: string[] = ['source = ?'];
        params.push('edgex');

        if (contract) {
          conditions.push('symbol = ?');
          params.push(contract);
        }

        if (from) {
          conditions.push('timestamp >= ?');
          params.push(parseInt(from));
        }

        if (to) {
          conditions.push('timestamp <= ?');
          params.push(parseInt(to));
        }

        query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const result = await env.DB.prepare(query).bind(...params).all();

        return new Response(JSON.stringify({
          contract: contract || 'all',
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

    // GET /api/edgex/overview - EdgeX Data Overview
    if (url.pathname === '/api/edgex/overview') {
      try {
        const contractStats = await env.DB.prepare(`
          SELECT symbol as contract_name,
                 COUNT(*) as total_minutes,
                 MIN(timestamp) as first_minute,
                 MAX(timestamp) as last_minute,
                 AVG(avg_bid) as overall_avg_bid,
                 AVG(avg_ask) as overall_avg_ask,
                 SUM(tick_count) as total_snapshots
          FROM orderbook_minutes
          WHERE source = 'edgex'
          GROUP BY symbol
          ORDER BY symbol
        `).all();

        return new Response(JSON.stringify({
          contracts: contractStats.results || [],
          count: contractStats.results?.length || 0
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

    // POST /api/edgex/start - Start EdgeX Tracker
    if (url.pathname === '/api/edgex/start' && request.method === 'POST') {
      try {
        const id = env.EDGEX_TRACKER.idFromName('edgex-tracker');
        const tracker = env.EDGEX_TRACKER.get(id);

        const result = await tracker.fetch(new Request('http://internal/start'));
        const data = await result.json();

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to start tracker' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // POST /api/edgex/stop - Stop EdgeX Tracker
    if (url.pathname === '/api/edgex/stop' && request.method === 'POST') {
      try {
        const id = env.EDGEX_TRACKER.idFromName('edgex-tracker');
        const tracker = env.EDGEX_TRACKER.get(id);

        const result = await tracker.fetch(new Request('http://internal/stop'));
        const data = await result.json();

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to stop tracker' }), {
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

    // EdgeX Dashboard
    if (url.pathname === '/edgex' || url.pathname === '/edgex.html') {
      return new Response(EDGEX_DASHBOARD, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },

  /**
   * Scheduled handler for Cron Triggers
   * Runs periodically to check for arbitrage alerts and ensure trackers are running
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('[Cron] 🕐 Scheduled task triggered:', event.cron);

    try {
      // Ensure all trackers are running (wakes them up if needed)
      console.log('[Cron] 🚀 Ensuring trackers are running...');

      const trackerChecks = [
        // Lighter
        (async () => {
          try {
            const id = env.LIGHTER_TRACKER.idFromName('lighter-tracker');
            const tracker = env.LIGHTER_TRACKER.get(id);
            const response = await tracker.fetch(new Request('http://internal/ensure-running'));
            console.log('[Cron] ✅ Lighter tracker checked');
          } catch (error) {
            console.error('[Cron] ❌ Lighter tracker check failed:', error);
          }
        })(),

        // Paradex
        (async () => {
          try {
            const id = env.PARADEX_TRACKER.idFromName('paradex-tracker');
            const tracker = env.PARADEX_TRACKER.get(id);
            const response = await tracker.fetch(new Request('http://internal/ensure-running'));
            console.log('[Cron] ✅ Paradex tracker checked');
          } catch (error) {
            console.error('[Cron] ❌ Paradex tracker check failed:', error);
          }
        })(),

        // Hyperliquid
        (async () => {
          try {
            const id = env.HYPERLIQUID_TRACKER.idFromName('hyperliquid-tracker');
            const tracker = env.HYPERLIQUID_TRACKER.get(id);
            const response = await tracker.fetch(new Request('http://internal/ensure-running'));
            console.log('[Cron] ✅ Hyperliquid tracker checked');
          } catch (error) {
            console.error('[Cron] ❌ Hyperliquid tracker check failed:', error);
          }
        })(),

        // EdgeX
        (async () => {
          try {
            const id = env.EDGEX_TRACKER.idFromName('edgex-tracker');
            const tracker = env.EDGEX_TRACKER.get(id);
            const response = await tracker.fetch(new Request('http://internal/ensure-running'));
            console.log('[Cron] ✅ EdgeX tracker checked');
          } catch (error) {
            console.error('[Cron] ❌ EdgeX tracker check failed:', error);
          }
        })()
      ];

      await Promise.all(trackerChecks);

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
      console.error('[Cron] ❌ Scheduled task failed:', error);
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
      <a href="/hyperliquid">Hyperliquid</a>
      <a href="/edgex">EdgeX</a>
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
      <a href="/overview">Overview</a>
      <a href="/lighter">Lighter</a>
      <a href="/paradex" class="active">Paradex</a>
      <a href="/hyperliquid">Hyperliquid</a>
      <a href="/edgex">EdgeX</a>
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
    .exchange-card.hyperliquid { border-left: 4px solid #ff9500; }
    .exchange-card.edgex { border-left: 4px solid #2d7dd2; }
    .exchange-card h2 {
      font-size: 24px;
      margin-bottom: 20px;
    }
    .exchange-card.lighter h2 { color: #00ff88; }
    .exchange-card.paradex h2 { color: #00d4ff; }
    .exchange-card.hyperliquid h2 { color: #ff9500; }
    .exchange-card.edgex h2 { color: #2d7dd2; }
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
    .btn-hyperliquid {
      background: #ff9500;
      color: #0a0b0d;
    }
    .btn-edgex {
      background: #2d7dd2;
      color: white;
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
      <a href="/overview" class="active">Overview</a>
      <a href="/lighter">Lighter</a>
      <a href="/paradex">Paradex</a>
      <a href="/hyperliquid">Hyperliquid</a>
      <a href="/edgex">EdgeX</a>
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

      <!-- Hyperliquid Card -->
      <div class="exchange-card hyperliquid">
        <h2>🟠 Hyperliquid</h2>
        <div class="stat-row">
          <span class="stat-label">Status</span>
          <span class="stat-value" id="hyperliquidStatus">Loading...</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Markets</span>
          <span class="stat-value" id="hyperliquidMarkets">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Messages</span>
          <span class="stat-value" id="hyperliquidMessages">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Snapshots</span>
          <span class="stat-value" id="hyperliquidSnapshots">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Minutes</span>
          <span class="stat-value" id="hyperliquidMinutes">-</span>
        </div>
        <a href="/hyperliquid" class="btn btn-hyperliquid">Open Dashboard →</a>
      </div>

      <!-- EdgeX Card -->
      <div class="exchange-card edgex">
        <h2>⚡ EdgeX</h2>
        <div class="stat-row">
          <span class="stat-label">Status</span>
          <span class="stat-value" id="edgexStatus">Loading...</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Markets</span>
          <span class="stat-value" id="edgexMarkets">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Messages</span>
          <span class="stat-value" id="edgexMessages">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Snapshots</span>
          <span class="stat-value" id="edgexSnapshots">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Minutes</span>
          <span class="stat-value" id="edgexMinutes">-</span>
        </div>
        <a href="/edgex" class="btn btn-edgex">Open Dashboard →</a>
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

      // Hyperliquid stats via WebSocket
      const hyperliquidWs = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/hyperliquid');
      hyperliquidWs.onopen = () => hyperliquidWs.send(JSON.stringify({ type: 'get_stats' }));
      hyperliquidWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'stats') {
          updateHyperliquidStats(msg.data);
          hyperliquidWs.close();
        }
      };

      // EdgeX stats via WebSocket
      const edgexWs = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/edgex');
      edgexWs.onopen = () => edgexWs.send(JSON.stringify({ type: 'get_stats' }));
      edgexWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'stats') {
          updateEdgeXStats(msg.data);
          edgexWs.close();
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

    function updateHyperliquidStats(data) {
      document.getElementById('hyperliquidStatus').textContent = data.isTracking ? '🟢 Tracking' : '🔴 Stopped';
      document.getElementById('hyperliquidMarkets').textContent = data.markets || 0;
      document.getElementById('hyperliquidMessages').textContent = (data.messagesReceived || 0).toLocaleString();
      document.getElementById('hyperliquidSnapshots').textContent = data.database?.snapshots || 0;
      document.getElementById('hyperliquidMinutes').textContent = data.database?.minutes || 0;
    }

    function updateEdgeXStats(data) {
      document.getElementById('edgexStatus').textContent = data.isTracking ? '🟢 Tracking' : '🔴 Stopped';
      document.getElementById('edgexMarkets').textContent = data.markets || 0;
      document.getElementById('edgexMessages').textContent = (data.messagesReceived || 0).toLocaleString();
      document.getElementById('edgexSnapshots').textContent = data.database?.snapshots || 0;
      document.getElementById('edgexMinutes').textContent = data.database?.minutes || 0;
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
  <title>Hyperliquid Orderbook Tracker</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #0a0b0d;
      color: #ff9500;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .nav { margin-bottom: 20px; }
    .nav a { color: #8b92a8; margin-right: 20px; text-decoration: none; }
    .nav a:hover { color: #ff9500; }
    .nav a.active { color: #ff9500; font-weight: bold; }
    h1 {
      font-size: 32px;
      margin-bottom: 10px;
      text-shadow: 0 0 10px #ff9500;
    }
    .subtitle {
      color: #8b92a8;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .control-panel {
      background: #1a1c26;
      border: 1px solid #ff9500;
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
    .status.running { background: rgba(255, 149, 0, 0.2); color: #ff9500; }
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
      background: #ff9500;
      color: #0a0b0d;
    }
    .btn-start:hover:not(:disabled) {
      background: #e68600;
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
      border-left: 3px solid #ff9500;
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
      <a href="/lighter">Lighter</a>
      <a href="/paradex">Paradex</a>
      <a href="/hyperliquid" class="active">Hyperliquid</a>
      <a href="/edgex">EdgeX</a>
    </div>
    <h1>🟠 HYPERLIQUID ORDERBOOK TRACKER</h1>
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
      log('Connecting to Hyperliquid WebSocket...');
      ws = new WebSocket(WS_URL + window.location.host + '/ws/hyperliquid');

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

    function updateStatus(isTracking, hyperliquidConnected) {
      const statusEl = document.getElementById('status');
      const startBtn = document.getElementById('startBtn');
      const stopBtn = document.getElementById('stopBtn');

      if (isTracking) {
        statusEl.textContent = '🟢 TRACKING';
        statusEl.className = 'status running';
        startBtn.disabled = true;
        stopBtn.disabled = false;
      } else {
        if (hyperliquidConnected) {
          statusEl.textContent = '🟢 READY';
        } else {
          statusEl.textContent = dashboardConnected ? '🔴 STOPPED' : '⚠️ DISCONNECTED';
        }
        statusEl.className = 'status stopped';
        // Button ist enabled wenn Dashboard verbunden ist (nicht Hyperliquid!)
        startBtn.disabled = !dashboardConnected;
        stopBtn.disabled = true;
      }
    }

    // Button handlers
    document.getElementById('startBtn').addEventListener('click', () => {
      log('Sending START command...');
      ws.send(JSON.stringify({ type: 'start_tracking' }));
    });

    document.getElementById('stopBtn').addEventListener('click', () => {
      log('Sending STOP command...');
      ws.send(JSON.stringify({ type: 'stop_tracking' }));
    });

    // Log function
    function log(msg) {
      const panel = document.getElementById('logPanel');
      const time = new Date().toLocaleTimeString('de-DE');
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = \`<span class="log-time">[\${time}]</span> \${msg}\`;
      panel.insertBefore(entry, panel.firstChild);

      // Keep only last 50 entries
      while (panel.children.length > 50) {
        panel.removeChild(panel.lastChild);
      }
    }

    // Stats refresh interval
    let statsInterval = null;

    function startStatsInterval() {
      if (statsInterval) clearInterval(statsInterval);
      statsInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'get_stats' }));
        }
      }, 5000); // Every 5 seconds
    }

    // Connect on load
    connect();
  </script>
</body>
</html>`;

const EDGEX_DASHBOARD = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EdgeX Orderbook Tracker</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #0a0b0d;
      color: #2d7dd2;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .nav { margin-bottom: 20px; }
    .nav a { color: #8b92a8; margin-right: 20px; text-decoration: none; }
    .nav a:hover { color: #2d7dd2; }
    .nav a.active { color: #2d7dd2; font-weight: bold; }
    h1 {
      font-size: 32px;
      margin-bottom: 10px;
      text-shadow: 0 0 10px #2d7dd2;
    }
    .subtitle {
      color: #8b92a8;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .control-panel {
      background: #1a1c26;
      border: 1px solid #2d7dd2;
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
    .status.running { background: rgba(45, 125, 210, 0.2); color: #2d7dd2; }
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
      background: #2d7dd2;
      color: white;
    }
    .btn-start:hover:not(:disabled) {
      background: #2569b8;
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
      border-left: 3px solid #2d7dd2;
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
      color: #2d7dd2;
    }
    .log-panel {
      background: #13141a;
      border: 1px solid #2d7dd2;
      border-radius: 8px;
      padding: 20px;
      max-height: 400px;
      overflow-y: auto;
    }
    .log-panel h2 {
      font-size: 16px;
      margin-bottom: 15px;
      color: #2d7dd2;
    }
    .log-entry {
      padding: 8px 0;
      border-bottom: 1px solid #1a1c26;
      font-size: 12px;
      color: #8b92a8;
    }
    .log-entry:last-child {
      border-bottom: none;
    }
    .log-entry.error {
      color: #ff3366;
    }
    .log-entry.success {
      color: #00ff88;
    }
    .websocket-status {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 8px;
    }
    .websocket-status.connected {
      background: #00ff88;
      box-shadow: 0 0 8px #00ff88;
    }
    .websocket-status.disconnected {
      background: #ff3366;
      box-shadow: 0 0 8px #ff3366;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="nav">
      <a href="/overview">Overview</a>
      <a href="/lighter">Lighter</a>
      <a href="/paradex">Paradex</a>
      <a href="/hyperliquid">Hyperliquid</a>
      <a href="/edgex">EdgeX</a>
      <a href="/edgex" class="active">EdgeX</a>
    </div>

    <h1>⚡ EdgeX Tracker</h1>
    <p class="subtitle">Real-time orderbook monitoring and aggregation</p>

    <div class="control-panel">
      <div>
        <span class="websocket-status disconnected" id="wsStatus"></span>
        <span class="status stopped" id="status">● STOPPED</span>
      </div>

      <div class="buttons">
        <button class="btn-start" id="startBtn" disabled>START TRACKING</button>
        <button class="btn-stop" id="stopBtn" disabled>STOP TRACKING</button>
      </div>

      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">Markets</div>
          <div class="stat-value" id="markets">-</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Connected</div>
          <div class="stat-value" id="connected">-</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Messages</div>
          <div class="stat-value" id="messages">-</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Last Update</div>
          <div class="stat-value" id="lastUpdate">-</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">DB Snapshots</div>
          <div class="stat-value" id="dbSnapshots">-</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">DB Minutes</div>
          <div class="stat-value" id="dbMinutes">-</div>
        </div>
      </div>
    </div>

    <div class="log-panel">
      <h2>📊 Activity Log</h2>
      <div id="logContainer"></div>
    </div>
  </div>

  <script>
    let ws = null;
    let dashboardConnected = false;
    let edgexConnected = false;
    let isTracking = false;

    function addLog(message, type = 'info') {
      const container = document.getElementById('logContainer');
      const entry = document.createElement('div');
      entry.className = \`log-entry \${type}\`;
      const timestamp = new Date().toLocaleTimeString('de-DE');
      entry.textContent = \`[\${timestamp}] \${message}\`;
      container.insertBefore(entry, container.firstChild);

      // Keep only last 50 entries
      while (container.children.length > 50) {
        container.removeChild(container.lastChild);
      }
    }

    function updateUI(stats) {
      isTracking = stats.isTracking;
      edgexConnected = stats.connected;

      document.getElementById('status').textContent = isTracking ? '● RUNNING' : '● STOPPED';
      document.getElementById('status').className = \`status \${isTracking ? 'running' : 'stopped'}\`;

      document.getElementById('markets').textContent = stats.markets || 0;
      document.getElementById('connected').textContent = stats.connected ? 'YES' : 'NO';
      document.getElementById('messages').textContent = (stats.messagesReceived || 0).toLocaleString();
      
      if (stats.lastMessageAt && stats.lastMessageAt > 0) {
        const seconds = Math.floor((Date.now() - stats.lastMessageAt) / 1000);
        document.getElementById('lastUpdate').textContent = \`\${seconds}s ago\`;
      } else {
        document.getElementById('lastUpdate').textContent = '-';
      }

      document.getElementById('dbSnapshots').textContent = (stats.database?.snapshots || 0).toLocaleString();
      document.getElementById('dbMinutes').textContent = (stats.database?.minutes || 0).toLocaleString();

      // Button states
      const startBtn = document.getElementById('startBtn');
      const stopBtn = document.getElementById('stopBtn');

      if (isTracking) {
        startBtn.disabled = true;
        stopBtn.disabled = !dashboardConnected;
      } else {
        startBtn.disabled = !dashboardConnected;
        stopBtn.disabled = true;
      }
    }

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = \`\${protocol}//\${window.location.host}/ws/edgex\`;
      
      addLog('Connecting to EdgeX tracker...', 'info');
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        dashboardConnected = true;
        document.getElementById('wsStatus').className = 'websocket-status connected';
        addLog('Dashboard connected', 'success');
        startStatsInterval();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'stats') {
            updateUI(data.data);
          } else if (data.type === 'status') {
            addLog(\`Status: \${JSON.stringify(data.data)}\`, 'info');
          } else if (data.type === 'message') {
            // Log incoming messages (optional, can be noisy)
          }
        } catch (error) {
          addLog(\`Parse error: \${error.message}\`, 'error');
        }
      };

      ws.onerror = (error) => {
        addLog('WebSocket error', 'error');
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        dashboardConnected = false;
        document.getElementById('wsStatus').className = 'websocket-status disconnected';
        addLog('Dashboard disconnected', 'error');
        if (statsInterval) clearInterval(statsInterval);
        
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };
    }

    document.getElementById('startBtn').addEventListener('click', async () => {
      addLog('Starting tracker...', 'info');
      try {
        const response = await fetch('/api/edgex/start', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
          addLog('Tracker started successfully', 'success');
        } else {
          addLog(\`Failed to start: \${result.message}\`, 'error');
        }
      } catch (error) {
        addLog(\`Start error: \${error.message}\`, 'error');
      }
    });

    document.getElementById('stopBtn').addEventListener('click', async () => {
      addLog('Stopping tracker...', 'info');
      try {
        const response = await fetch('/api/edgex/stop', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
          addLog('Tracker stopped successfully', 'success');
        } else {
          addLog(\`Failed to stop: \${result.message}\`, 'error');
        }
      } catch (error) {
        addLog(\`Stop error: \${error.message}\`, 'error');
      }
    });

    // Stats refresh interval
    let statsInterval = null;

    function startStatsInterval() {
      if (statsInterval) clearInterval(statsInterval);
      statsInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'get_stats' }));
        }
      }, 5000); // Every 5 seconds
    }

    // Connect on load
    connect();
  </script>
</body>
</html>`;
