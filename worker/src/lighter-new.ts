/**
 * Lighter Orderbook Tracker - Durable Object
 * Clean implementation with streaming aggregation
 */

import { OrderbookAggregator } from './aggregator-new';

export interface Env {
  DB: D1Database;
}

interface MarketMapping {
  market_index: number;
  symbol: string;
}

export class LighterTracker {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Set<WebSocket>;

  // WebSocket connection
  private ws: WebSocket | null = null;
  private pingInterval: any = null;
  private reconnectTimeout: any = null;

  // Markets
  private markets: Map<number, string> = new Map(); // market_index → symbol

  // Tracking state
  private isTracking: boolean = false;

  // Aggregator
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

    console.log(`[Lighter] 🎬 Durable Object created`);

    // Load tracking state - AUTO-START by default
    this.state.blockConcurrencyWhile(async () => {
      const storedState = await this.state.storage.get<boolean>('isTracking');
      // Auto-start if never set before (undefined), otherwise use stored state
      this.isTracking = storedState !== undefined ? storedState : true;
      console.log(`[Lighter] 📂 Loaded state: isTracking=${this.isTracking} (stored=${storedState})`);

      // Persist the auto-start state if this is first time
      if (storedState === undefined) {
        await this.state.storage.put('isTracking', true);
      }

      // Auto-start tracking if enabled (MUST be inside blockConcurrencyWhile!)
      if (this.isTracking) {
        console.log(`[Lighter] ▶️ Auto-starting tracking...`);
        this.initialize();
      }
    });
  }

  /**
   * Initialisierung
   */
  async initialize(): Promise<void> {
    console.log(`[Lighter] 🔧 Initializing...`);

    // Aggregator erstellen
    this.aggregator = new OrderbookAggregator(this.env.DB);

    // Markets laden
    await this.loadMarkets();

    // WebSocket verbinden
    await this.connect();

    console.log(`[Lighter] ✅ Initialized`);
  }

  /**
   * Lädt Market-Symbol Mapping von Lighter API
   */
  async loadMarkets(): Promise<void> {
    console.log(`[Lighter] 🔍 Loading markets from API...`);

    try {
      // Verwende die orderBooks API statt explorer API
      const response = await fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBooks', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LighterTracker/1.0)',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.code !== 200 || !data.order_books) {
        throw new Error('Invalid API response format');
      }

      console.log(`[Lighter] 📋 Received ${data.order_books.length} markets from API`);

      // Extrahiere Market-Index und Symbol
      const activeMarkets = data.order_books.filter((m: any) => m.status === 'active');

      for (const market of activeMarkets) {
        // market_id ist der numeric index, symbol ist z.B. "ETH/USDC"
        const marketIndex = parseInt(market.market_id);

        // Extrahiere Base-Asset (z.B. "ETH" aus "ETH/USDC")
        const symbol = market.symbol.split(/[\/\-]/)[0];

        this.markets.set(marketIndex, symbol);
      }

      // In Datenbank speichern
      const statements = Array.from(this.markets.entries()).map(([index, symbol]) =>
        this.env.DB.prepare(
          `INSERT OR REPLACE INTO lighter_markets (market_index, symbol, last_updated)
           VALUES (?, ?, ?)`
        ).bind(index, symbol, Date.now())
      );

      // Batch insert (max 50)
      const batches = this.chunkArray(statements, 50);
      for (const batch of batches) {
        await this.env.DB.batch(batch);
      }

      console.log(`[Lighter] ✅ Loaded ${this.markets.size} active markets`);
      console.log(`[Lighter] 📊 Sample markets:`, Array.from(this.markets.entries()).slice(0, 5));

    } catch (error) {
      console.error(`[Lighter] ❌ Failed to load markets:`, error);
      throw error;
    }
  }

  /**
   * WebSocket Verbindung
   */
  async connect(): Promise<void> {
    console.log(`[Lighter] 🔌 Connecting to WebSocket...`);

    try {
      const ws = new WebSocket('wss://mainnet.zklighter.elliot.ai/stream');

      ws.addEventListener('open', () => {
        console.log(`[Lighter] ✅ WebSocket connected`);
        this.stats.connectedAt = Date.now();

        // Subscribe zu allen Markets
        console.log(`[Lighter] 📡 Subscribing to ${this.markets.size} markets...`);
        for (const marketIndex of this.markets.keys()) {
          this.subscribeMarket(marketIndex);
        }

        this.startPing();
      });

      ws.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      ws.addEventListener('close', (event) => {
        console.log(`[Lighter] ❌ WebSocket closed (code: ${event.code})`);
        this.ws = null;
        this.stopPing();

        // Nur reconnect wenn noch tracking
        if (this.isTracking) {
          console.log(`[Lighter] 🔄 Reconnecting in 5s...`);
          this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
        }
      });

      ws.addEventListener('error', (error) => {
        console.error(`[Lighter] ❌ WebSocket error:`, error);
        this.stats.errors++;
      });

      this.ws = ws;

    } catch (error) {
      console.error(`[Lighter] ❌ Connection failed:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Subscribe zu Market
   */
  subscribeMarket(marketIndex: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        channel: `order_book/${marketIndex}`
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
        this.ws.send(JSON.stringify({ type: 'ping' }));
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

      // Pong ignorieren
      if (message.type === 'pong') {
        return;
      }

      this.stats.messagesReceived++;
      this.stats.lastMessageAt = Date.now();

      // Orderbook Update
      if (message.channel && message.channel.startsWith('order_book:')) {
        const marketIndex = parseInt(message.channel.replace('order_book:', ''));
        await this.processOrderbook(marketIndex, message);
      }

    } catch (error) {
      console.error(`[Lighter] ❌ Message handling error:`, error);
      this.stats.errors++;
    }
  }

  /**
   * Verarbeitet Orderbook Update
   */
  async processOrderbook(marketIndex: number, message: any): Promise<void> {
    const { order_book } = message;
    if (!order_book) return;

    const symbol = this.markets.get(marketIndex);
    if (!symbol) {
      // Market nicht bekannt - sollte nicht passieren
      return;
    }

    const { asks, bids } = order_book;

    // Beste Preise extrahieren
    const bestBid = bids && bids.length > 0 ? parseFloat(bids[0].price) : null;
    const bestAsk = asks && asks.length > 0 ? parseFloat(asks[0].price) : null;

    // An Aggregator übergeben
    if (this.aggregator && (bestBid !== null || bestAsk !== null)) {
      this.aggregator.process(symbol, bestBid, bestAsk);
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
      console.log(`[Lighter] ▶️ Starting tracking...`);

      this.isTracking = true;
      await this.state.storage.put('isTracking', true);

      await this.initialize();

      console.log(`[Lighter] ✅ Tracking started`);
      this.broadcast({ type: 'status', data: { isTracking: true } });

      return { success: true, message: 'Tracking started' };

    } catch (error) {
      console.error(`[Lighter] ❌ Start failed:`, error);

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

    console.log(`[Lighter] ⏸️ Stopping tracking...`);

    this.isTracking = false;
    await this.state.storage.put('isTracking', false);

    // Cleanup reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Flush aggregator
    if (this.aggregator) {
      console.log(`[Lighter] 💾 Flushing aggregator...`);
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

    console.log(`[Lighter] ⏹️ Tracking stopped`);
    this.broadcast({ type: 'status', data: { isTracking: false } });

    return { success: true, message: 'Tracking stopped' };
  }

  /**
   * Get Stats
   */
  async getStats(): Promise<any> {
    // DB Stats
    const snapshotsCount = await this.env.DB.prepare(
      `SELECT COUNT(*) as count FROM lighter_snapshots`
    ).first();

    const minutesCount = await this.env.DB.prepare(
      `SELECT COUNT(*) as count FROM lighter_minutes`
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

    // Handle internal ensure-running ping (wakes up DO and triggers auto-start)
    if (url.pathname === '/ensure-running') {
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

    console.log(`[Lighter] 👤 Client connected (${this.sessions.size} total)`);

    // Send initial stats
    const stats = await this.getStats();
    websocket.send(JSON.stringify({ type: 'stats', data: stats }));

    websocket.addEventListener('message', async (msg) => {
      try {
        const data = JSON.parse(msg.data as string);
        await this.handleClientMessage(data, websocket);
      } catch (error) {
        console.error(`[Lighter] ❌ Client message error:`, error);
      }
    });

    websocket.addEventListener('close', () => {
      this.sessions.delete(websocket);
      console.log(`[Lighter] 👋 Client disconnected (${this.sessions.size} remaining)`);
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
        console.error(`[Lighter] ❌ Broadcast error:`, error);
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
