/**
 * Hyperliquid Tracker - Durable Object
 *
 * Tracks orderbook data from Hyperliquid DEX
 * WebSocket: wss://api.hyperliquid.xyz/ws
 * API: https://api.hyperliquid.xyz/info
 */

import { DurableObject } from 'cloudflare:workers';
import { OrderbookAggregator } from './aggregator-new';

export interface Env {
  DB: D1Database;
}

export class HyperliquidTracker extends DurableObject<Env> {
  private ws: WebSocket | null = null;
  private markets: Map<string, string> = new Map(); // symbol -> symbol (direct mapping)
  private aggregator: OrderbookAggregator | null = null;
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private sessions: Set<WebSocket> = new Set();
  private isTracking: boolean = false;
  private messagesReceived: number = 0;
  private lastMessageAt: number = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    console.log(`[Hyperliquid] 🎬 Durable Object created`);

    // Load tracking state - AUTO-START by default
    this.ctx.blockConcurrencyWhile(async () => {
      const storedState = await this.ctx.storage.get<boolean>('isTracking');
      // Auto-start if never set before (undefined), otherwise use stored state
      this.isTracking = storedState !== undefined ? storedState : true;
      console.log(`[Hyperliquid] 📂 Loaded state: isTracking=${this.isTracking} (stored=${storedState})`);

      // Persist the auto-start state if this is first time
      if (storedState === undefined) {
        await this.ctx.storage.put('isTracking', true);
      }
    });

    if (this.isTracking) {
      console.log(`[Hyperliquid] ▶️ Auto-starting tracking...`);
      setTimeout(() => this.startTracking(), 1000);
    }
  }

  /**
   * Load markets from Hyperliquid API
   */
  async loadMarkets(): Promise<void> {
    console.log(`[Hyperliquid] 🔍 Loading markets from API...`);

    try {
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; HyperliquidTracker/1.0)'
        },
        body: JSON.stringify({ type: 'meta' })
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.universe || !Array.isArray(data.universe)) {
        throw new Error('Invalid API response format');
      }

      console.log(`[Hyperliquid] 📋 Received ${data.universe.length} markets from API`);

      // Store all tradable coins
      for (const market of data.universe) {
        const symbol = market.name;
        this.markets.set(symbol, symbol); // Direct mapping (BTC -> BTC)
      }

      // Batch insert to database
      const statements = Array.from(this.markets.keys()).map(symbol => {
        return this.env.DB.prepare(
          `INSERT OR REPLACE INTO hyperliquid_markets (symbol, last_updated)
           VALUES (?, ?)`
        ).bind(symbol, Date.now());
      });

      // Batch insert (max 50 per batch)
      const batches = this.chunkArray(statements, 50);
      for (const batch of batches) {
        await this.env.DB.batch(batch);
      }

      console.log(`[Hyperliquid] ✅ Loaded ${this.markets.size} markets`);
      console.log(`[Hyperliquid] 📊 Sample markets:`, Array.from(this.markets.keys()).slice(0, 10));

    } catch (error) {
      console.error(`[Hyperliquid] ❌ Failed to load markets:`, error);
      throw error;
    }
  }

  /**
   * Connect to Hyperliquid WebSocket
   */
  connectWebSocket(): void {
    if (this.ws) {
      console.log(`[Hyperliquid] ⚠️ WebSocket already exists`);
      return;
    }

    console.log(`[Hyperliquid] 🔌 Connecting to WebSocket...`);

    try {
      this.ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

      this.ws.addEventListener('open', () => {
        console.log(`[Hyperliquid] ✅ WebSocket connected`);
        this.startPing();
        this.subscribeAllMarkets();
      });

      this.ws.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      this.ws.addEventListener('close', (event) => {
        console.log(`[Hyperliquid] 🔌 WebSocket closed:`, event.code, event.reason);
        this.cleanup();
        this.scheduleReconnect();
      });

      this.ws.addEventListener('error', (event) => {
        console.error(`[Hyperliquid] ❌ WebSocket error:`, event);
      });

    } catch (error) {
      console.error(`[Hyperliquid] ❌ Failed to create WebSocket:`, error);
      this.scheduleReconnect();
    }
  }

  /**
   * Subscribe to all markets
   */
  subscribeAllMarkets(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log(`[Hyperliquid] ⚠️ WebSocket not ready for subscriptions`);
      return;
    }

    console.log(`[Hyperliquid] 📡 Subscribing to ${this.markets.size} markets...`);

    let subscribed = 0;
    for (const symbol of this.markets.keys()) {
      this.subscribeMarket(symbol);
      subscribed++;
    }

    console.log(`[Hyperliquid] ✅ Subscribed to ${subscribed} markets`);
  }

  /**
   * Subscribe to single market
   */
  subscribeMarket(symbol: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: {
          type: 'l2Book',
          coin: symbol
        }
      }));
    }
  }

  /**
   * Start ping interval (keep-alive)
   */
  startPing(): void {
    this.stopPing();

    // Hyperliquid might not need explicit ping, but we'll send periodic pings
    // to ensure the connection stays alive
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Send a ping message (Hyperliquid might handle this internally)
        // If there's no explicit ping method, this keeps the connection active
        try {
          this.ws.send(JSON.stringify({ method: 'ping' }));
        } catch (error) {
          console.error(`[Hyperliquid] ❌ Ping failed:`, error);
        }
      }
    }, 30000); // 30 seconds
  }

  stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Handle WebSocket message
   */
  handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      this.messagesReceived++;
      this.lastMessageAt = Date.now();

      // Handle l2Book updates
      if (message.channel === 'l2Book' && message.data) {
        this.processOrderbook(message.data);
      }

      // Handle pong responses
      if (message.channel === 'pong') {
        // Connection is alive
      }

    } catch (error) {
      console.error(`[Hyperliquid] ❌ Failed to parse message:`, error);
    }
  }

  /**
   * Process orderbook update
   */
  async processOrderbook(data: any): Promise<void> {
    const { coin, levels } = data;

    if (!coin || !levels || !Array.isArray(levels) || levels.length < 2) {
      return;
    }

    const symbol = this.markets.get(coin);
    if (!symbol) {
      return;
    }

    const bids = levels[0]; // Array of bid levels
    const asks = levels[1]; // Array of ask levels

    // Extract best bid/ask
    let bestBid: number | null = null;
    let bestAsk: number | null = null;

    if (bids && bids.length > 0 && bids[0].px) {
      bestBid = parseFloat(bids[0].px);
    }

    if (asks && asks.length > 0 && asks[0].px) {
      bestAsk = parseFloat(asks[0].px);
    }

    // Pass to aggregator
    if (this.aggregator && (bestBid !== null || bestAsk !== null)) {
      this.aggregator.process(symbol, bestBid, bestAsk);
    }
  }

  /**
   * Cleanup connections
   */
  cleanup(): void {
    this.stopPing();

    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // Ignore
      }
      this.ws = null;
    }
  }

  /**
   * Schedule reconnect
   */
  scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.isTracking) {
      console.log(`[Hyperliquid] 🔄 Reconnecting in 5 seconds...`);
      this.reconnectTimer = setTimeout(() => {
        this.connectWebSocket();
      }, 5000);
    }
  }

  /**
   * Start tracking
   */
  async startTracking(): Promise<any> {
    if (this.isTracking) {
      return { success: false, message: 'Already tracking' };
    }

    console.log(`[Hyperliquid] 🚀 Starting tracker...`);

    try {
      // Initialize aggregator
      this.aggregator = new OrderbookAggregator(this.env.DB, 'hyperliquid');

      // Load markets
      await this.loadMarkets();

      // Connect WebSocket
      this.connectWebSocket();

      this.isTracking = true;
      await this.ctx.storage.put('isTracking', true);

      console.log(`[Hyperliquid] ✅ Tracking started`);

      this.broadcast({
        type: 'status',
        data: { isTracking: true, markets: this.markets.size }
      });

      return {
        success: true,
        message: 'Tracking started',
        markets: this.markets.size
      };

    } catch (error: any) {
      console.error(`[Hyperliquid] ❌ Failed to start:`, error);
      this.isTracking = false;
      return {
        success: false,
        message: error.message || 'Failed to start tracking'
      };
    }
  }

  /**
   * Stop tracking
   */
  async stopTracking(): Promise<any> {
    if (!this.isTracking) {
      return { success: false, message: 'Not tracking' };
    }

    console.log(`[Hyperliquid] ⏸️ Stopping tracker...`);

    this.isTracking = false;
    await this.ctx.storage.put('isTracking', false);
    this.cleanup();

    if (this.aggregator) {
      await this.aggregator.flush();
      this.aggregator = null;
    }

    console.log(`[Hyperliquid] ✅ Tracking stopped`);

    this.broadcast({
      type: 'status',
      data: { isTracking: false }
    });

    return { success: true, message: 'Tracking stopped' };
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<any> {
    const snapshotCount = await this.env.DB.prepare(
      `SELECT COUNT(*) as count FROM hyperliquid_snapshots`
    ).first();

    const minuteCount = await this.env.DB.prepare(
      `SELECT COUNT(*) as count FROM hyperliquid_minutes`
    ).first();

    return {
      isTracking: this.isTracking,
      markets: this.markets.size,
      connected: this.ws?.readyState === WebSocket.OPEN,
      messagesReceived: this.messagesReceived,
      lastMessageAt: this.lastMessageAt,
      database: {
        snapshots: snapshotCount?.count || 0,
        minutes: minuteCount?.count || 0
      },
      aggregator: this.aggregator?.getStats() || null
    };
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(message: any): void {
    const data = JSON.stringify(message);
    for (const session of this.sessions) {
      try {
        session.send(data);
      } catch (error) {
        console.error(`[Hyperliquid] ❌ Failed to send to session:`, error);
        this.sessions.delete(session);
      }
    }
  }

  /**
   * Utility: Chunk array
   */
  chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Handle HTTP/WebSocket requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // MUST call accept() BEFORE sending any messages
      server.accept();
      this.sessions.add(server);

      console.log(`[Hyperliquid] 👤 Client connected (${this.sessions.size} total)`);

      // Send initial stats
      const stats = await this.getStats();
      server.send(JSON.stringify({ type: 'stats', data: stats }));

      server.addEventListener('message', async (msg) => {
        try {
          const data = JSON.parse(msg.data as string);

          switch (data.type) {
            case 'get_stats':
              const stats = await this.getStats();
              server.send(JSON.stringify({ type: 'stats', data: stats }));
              break;

            case 'start_tracking':
              const startResult = await this.startTracking();
              server.send(JSON.stringify({ type: 'control', data: startResult }));
              break;

            case 'stop_tracking':
              const stopResult = await this.stopTracking();
              server.send(JSON.stringify({ type: 'control', data: stopResult }));
              break;
          }
        } catch (error) {
          console.error(`[Hyperliquid] ❌ WebSocket message error:`, error);
        }
      });

      server.addEventListener('close', () => {
        this.sessions.delete(server);
        console.log(`[Hyperliquid] 👋 Client disconnected (${this.sessions.size} remaining)`);
      });

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    // HTTP endpoints
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // GET /stats
    if (url.pathname === '/stats') {
      const stats = await this.getStats();
      return new Response(JSON.stringify(stats), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
}
