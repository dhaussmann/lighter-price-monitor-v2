/**
 * Multi-Exchange Orderbook Tracker
 * Tracks orderbook data from Lighter and Paradex
 */

export interface Env {
  ORDERBOOK_TRACKER: DurableObjectNamespace;
  DB: D1Database;
}

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

  // Token mappings cache
  private tokenMappings: Map<string, TokenMapping> = new Map();

  // Tracked markets
  private lighterMarkets: Set<string> = new Set();
  private paradexMarkets: Set<string> = new Set();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();

    // Auto-start tracking on initialization
    this.initialize();
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
      // Discover Lighter markets (LIMIT to save memory)
      const lighterResponse = await fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBooks');
      const lighterData = await lighterResponse.json();

      if (lighterData.code === 200 && lighterData.order_books) {
        // Only track first 10 markets to save memory
        let count = 0;
        for (const market of lighterData.order_books) {
          if (market.status === 'active' && count < 10) {
            this.lighterMarkets.add(market.market_id);
            await this.ensureTokenMapping('lighter', market.market_id, market.symbol);
            count++;
          }
        }
        console.log(`Tracking ${this.lighterMarkets.size} Lighter markets (limited for memory)`);
      }

      // Discover Paradex markets (LIMIT to save memory)
      const paradexResponse = await fetch('https://api.prod.paradex.trade/v1/markets');
      const paradexData = await paradexResponse.json();

      if (paradexData.results) {
        // Only track top 15 markets by volume to save memory
        const topMarkets = paradexData.results
          .filter((m: any) => m.market_type === 'PERP')
          .slice(0, 15);

        for (const market of topMarkets) {
          this.paradexMarkets.add(market.symbol);

          // Extract normalized symbol (e.g., ETH-USD-PERP -> ETH)
          const baseAsset = market.symbol.split('-')[0];
          await this.ensureTokenMapping('paradex', market.symbol, baseAsset);
        }
        console.log(`Tracking ${this.paradexMarkets.size} Paradex markets (limited for memory)`);
      }
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

      // Limit to 10 asks and 10 bids to save memory
      const limitedAsks = asks?.slice(0, 10) || [];
      const limitedBids = bids?.slice(0, 10) || [];

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

      // Limit to 15 entries to save memory
      const limitedInserts = inserts.slice(0, 15);

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
          paradex_connected: this.paradexWs?.readyState === WebSocket.OPEN
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

    // Statische Info-Seite
    if (url.pathname === '/') {
      return new Response('Multi-Exchange Orderbook Tracker - Lighter + Paradex', {
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
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
