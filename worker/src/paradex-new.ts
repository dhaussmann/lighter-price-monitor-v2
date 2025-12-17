/**
 * Paradex Orderbook Tracker - Durable Object
 * Clean implementation with streaming aggregation (nur Orderbooks)
 */

import { OrderbookAggregator } from './aggregator-new';

export interface Env {
  DB: D1Database;
}

interface ParadexMarket {
  symbol: string;
  market_type: string;
  base_currency: string;
  quote_currency: string;
}

export class ParadexTracker {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Set<WebSocket>;

  // WebSocket connection
  private ws: WebSocket | null = null;
  private pingInterval: any = null;
  private reconnectTimeout: any = null;

  // Markets (symbol → normalized symbol)
  private markets: Map<string, string> = new Map(); // "BTC-USD-PERP" → "BTC"

  // Tracking state
  private isTracking: boolean = false;

  // Aggregator (verwendet paradex_ Tabellen)
  private aggregator: OrderbookAggregator | null = null;

  // Stats
  private stats = {
    messagesReceived: 0,
    lastMessageAt: 0,
    connectedAt: 0,
    errors: 0,
  };

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();

    console.log(`[Paradex] 🎬 Durable Object created`);

    // Load tracking state - AUTO-START by default
    this.state.blockConcurrencyWhile(async () => {
      const storedState = await this.state.storage.get<boolean>('isTracking');
      // Auto-start if never set before (undefined), otherwise use stored state
      this.isTracking = storedState !== undefined ? storedState : true;
      console.log(`[Paradex] 📂 Loaded state: isTracking=${this.isTracking} (stored=${storedState})`);

      // Persist the auto-start state if this is first time
      if (storedState === undefined) {
        await this.state.storage.put('isTracking', true);
      }

      // Auto-start tracking if enabled (MUST be inside blockConcurrencyWhile!)
      if (this.isTracking) {
        console.log(`[Paradex] ▶️ Auto-starting tracking...`);
        this.initialize();
      }
    });
  }

  /**
   * Initialisierung
   */
  async initialize(): Promise<void> {
    console.log(`[Paradex] 🔧 Initializing...`);

    // Aggregator erstellen (mit paradex_ prefix)
    this.aggregator = new OrderbookAggregator(this.env.DB, 'paradex');

    // Markets laden
    await this.loadMarkets();

    // WebSocket verbinden
    await this.connect();

    console.log(`[Paradex] ✅ Initialized`);
  }

  /**
   * Lädt Markets von Paradex API
   */
  async loadMarkets(): Promise<void> {
    console.log(`[Paradex] 🔍 Loading markets from API...`);

    try {
      const response = await fetch('https://api.prod.paradex.trade/v1/markets', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ParadexTracker/1.0)',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.results || !Array.isArray(data.results)) {
        throw new Error('Invalid API response format');
      }

      console.log(`[Paradex] 📋 Received ${data.results.length} markets from API`);

      // Nur echte Perpetual Futures: asset_kind = 'PERP' UND Symbol endet mit '-PERP'
      // Filtert PERP_OPTION (wie BTC-USD-110000-P) aus
      const perpMarkets = data.results.filter((m: any) =>
        m.asset_kind === 'PERP' && m.symbol.endsWith('-PERP')
      );

      console.log(`[Paradex] 📊 Filtered ${perpMarkets.length} PERP markets`);

      for (const market of perpMarkets) {
        // Symbol: "BTC-USD-PERP" → Normalized: "BTC"
        const normalizedSymbol = market.symbol.split('-')[0];
        this.markets.set(market.symbol, normalizedSymbol);
      }

      // In Datenbank speichern
      const statements = perpMarkets.map((m: any) => {
        const baseAsset = m.symbol.split('-')[0];
        const quoteAsset = m.symbol.split('-')[1] || 'USD';

        return this.env.DB.prepare(
          `INSERT OR REPLACE INTO paradex_markets (symbol, market_type, base_asset, quote_asset, last_updated)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(m.symbol, m.asset_kind, baseAsset, quoteAsset, Date.now());
      });

      // Batch insert (max 50)
      const batches = this.chunkArray(statements, 50);
      for (const batch of batches) {
        await this.env.DB.batch(batch);
      }

      console.log(`[Paradex] ✅ Loaded ${this.markets.size} PERP markets`);
      console.log(`[Paradex] 📊 Sample markets:`, Array.from(this.markets.entries()).slice(0, 5));

    } catch (error) {
      console.error(`[Paradex] ❌ Failed to load markets:`, error);
      throw error;
    }
  }

  /**
   * WebSocket Verbindung
   */
  async connect(): Promise<void> {
    console.log(`[Paradex] 🔌 Connecting to WebSocket...`);

    try {
      const ws = new WebSocket('wss://ws.api.prod.paradex.trade/v1');

      ws.addEventListener('open', () => {
        console.log(`[Paradex] ✅ WebSocket connected`);
        this.stats.connectedAt = Date.now();

        // Subscribe zu allen Markets
        console.log(`[Paradex] 📡 Subscribing to ${this.markets.size} markets...`);
        for (const symbol of this.markets.keys()) {
          this.subscribeMarket(symbol);
        }

        this.startPing();
      });

      ws.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      ws.addEventListener('close', (event) => {
        console.log(`[Paradex] ❌ WebSocket closed (code: ${event.code})`);
        this.ws = null;
        this.stopPing();

        // Nur reconnect wenn noch tracking
        if (this.isTracking) {
          console.log(`[Paradex] 🔄 Reconnecting in 5s...`);
          this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
        }
      });

      ws.addEventListener('error', (error) => {
        console.error(`[Paradex] ❌ WebSocket error:`, error);
        this.stats.errors++;
      });

      this.ws = ws;

    } catch (error) {
      console.error(`[Paradex] ❌ Connection failed:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Subscribe zu Market Orderbook
   */
  subscribeMarket(symbol: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: {
          channel: `order_book.${symbol}.snapshot@15@50ms`
        },
        id: Date.now()
      }));
    }
  }

  /**
   * Ping-Pong
   */
  startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'ping',
          id: Date.now()
        }));
      }
    }, 30000);
  }

  stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Handle WebSocket Message
   */
  async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      // Pong/OK ignorieren
      if (message.result === 'ok' || message.method === 'pong') {
        return;
      }

      this.stats.messagesReceived++;
      this.stats.lastMessageAt = Date.now();

      // Orderbook Update
      if (message.method === 'subscription' && message.params) {
        const { channel, data: channelData } = message.params;

        if (channel && channel.startsWith('order_book.')) {
          await this.processOrderbook(channelData);
        }
      }

    } catch (error) {
      console.error(`[Paradex] ❌ Message handling error:`, error);
      this.stats.errors++;
    }
  }

  /**
   * Verarbeitet Orderbook Update
   */
  async processOrderbook(data: any): Promise<void> {
    const { market, inserts } = data;
    if (!inserts || !Array.isArray(inserts)) return;

    const normalizedSymbol = this.markets.get(market);
    if (!normalizedSymbol) {
      // Market nicht bekannt
      return;
    }

    // Beste Preise extrahieren
    let bestBid: number | null = null;
    let bestAsk: number | null = null;

    for (const entry of inserts) {
      const price = parseFloat(entry.price);

      if (entry.side === 'BUY') {
        if (bestBid === null || price > bestBid) {
          bestBid = price;
        }
      } else if (entry.side === 'SELL') {
        if (bestAsk === null || price < bestAsk) {
          bestAsk = price;
        }
      }
    }

    // An Aggregator übergeben
    if (this.aggregator && (bestBid !== null || bestAsk !== null)) {
      this.aggregator.process(normalizedSymbol, bestBid, bestAsk);
    }
  }

  /**
   * Start Tracking
   */
  async startTracking(): Promise<{ success: boolean; message: string }> {
    if (this.isTracking) {
      return { success: false, message: 'Already tracking' };
    }

    try {
      console.log(`[Paradex] ▶️ Starting tracking...`);

      this.isTracking = true;
      await this.state.storage.put('isTracking', true);

      await this.initialize();

      console.log(`[Paradex] ✅ Tracking started`);
      this.broadcast({ type: 'status', data: { isTracking: true } });

      return { success: true, message: 'Tracking started' };

    } catch (error) {
      console.error(`[Paradex] ❌ Start failed:`, error);

      // Rollback
      this.isTracking = false;
      await this.state.storage.put('isTracking', false);

      return {
        success: false,
        message: `Start failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * Stop Tracking
   */
  async stopTracking(): Promise<{ success: boolean; message: string }> {
    if (!this.isTracking) {
      return { success: false, message: 'Already stopped' };
    }

    console.log(`[Paradex] ⏸️ Stopping tracking...`);

    this.isTracking = false;
    await this.state.storage.put('isTracking', false);

    // Cleanup reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Flush aggregator
    if (this.aggregator) {
      console.log(`[Paradex] 💾 Flushing aggregator...`);
      await this.aggregator.flush();
      this.aggregator.stop();
      this.aggregator = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.stopPing();

    console.log(`[Paradex] ⏹️ Tracking stopped`);
    this.broadcast({ type: 'status', data: { isTracking: false } });

    return { success: true, message: 'Tracking stopped' };
  }

  /**
   * Get Stats
   */
  async getStats(): Promise<any> {
    // DB Stats
    const snapshotsCount = await this.env.DB.prepare(
      `SELECT COUNT(*) as count FROM paradex_snapshots`
    ).first();

    const minutesCount = await this.env.DB.prepare(
      `SELECT COUNT(*) as count FROM paradex_minutes`
    ).first();

    return {
      isTracking: this.isTracking,
      markets: this.markets.size,
      connected: this.ws?.readyState === WebSocket.OPEN,
      messagesReceived: this.stats.messagesReceived,
      lastMessageAt: this.stats.lastMessageAt,
      connectedAt: this.stats.connectedAt,
      errors: this.stats.errors,
      database: {
        snapshots: snapshotsCount?.count || 0,
        minutes: minutesCount?.count || 0,
      },
      aggregator: this.aggregator?.getStats() || null,
    };
  }

  /**
   * WebSocket Handler (für Dashboard) + HTTP endpoints
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle internal ensure-running ping (wakes up DO and ensures tracking is active)
    if (url.pathname === '/ensure-running') {
      console.log(`[Paradex] 🔍 Ensure-running check: isTracking=${this.isTracking}`);

      // Auto-start if not already tracking
      if (!this.isTracking) {
        console.log(`[Paradex] 🚀 Auto-starting from ensure-running...`);
        try {
          await this.initialize();
          this.isTracking = true;
          await this.state.storage.put('isTracking', true);
          console.log(`[Paradex] ✅ Auto-start successful`);
        } catch (error) {
          console.error(`[Paradex] ❌ Auto-start failed:`, error);
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        isTracking: this.isTracking,
        markets: this.markets.size
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    await this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleSession(websocket: WebSocket): Promise<void> {
    websocket.accept();
    this.sessions.add(websocket);

    console.log(`[Paradex] 👤 Client connected (${this.sessions.size} total)`);

    // Send initial stats
    const stats = await this.getStats();
    websocket.send(JSON.stringify({ type: 'stats', data: stats }));

    websocket.addEventListener('message', async (msg) => {
      try {
        const data = JSON.parse(msg.data as string);
        await this.handleClientMessage(data, websocket);
      } catch (error) {
        console.error(`[Paradex] ❌ Client message error:`, error);
      }
    });

    websocket.addEventListener('close', () => {
      this.sessions.delete(websocket);
      console.log(`[Paradex] 👋 Client disconnected (${this.sessions.size} remaining)`);
    });
  }

  async handleClientMessage(data: any, websocket: WebSocket): Promise<void> {
    switch (data.type) {
      case 'get_stats':
        const stats = await this.getStats();
        websocket.send(JSON.stringify({ type: 'stats', data: stats }));
        break;

      case 'start_tracking':
        const startResult = await this.startTracking();
        websocket.send(JSON.stringify({ type: 'control', data: startResult }));
        break;

      case 'stop_tracking':
        const stopResult = await this.stopTracking();
        websocket.send(JSON.stringify({ type: 'control', data: stopResult }));
        break;
    }
  }

  broadcast(message: any): void {
    const data = JSON.stringify(message);
    for (const session of this.sessions) {
      try {
        session.send(data);
      } catch (error) {
        console.error(`[Paradex] ❌ Broadcast error:`, error);
      }
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
