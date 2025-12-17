import { DurableObject } from 'cloudflare:workers';
import { OrderBookAggregator } from './aggregator';

interface Env {
  DB: D1Database;
}

/**
 * EdgeX Tracker Durable Object
 */
export class EdgeXTracker extends DurableObject<Env> {
  private ws: WebSocket | null = null;
  private markets: Map<string, string> = new Map(); // contractId -> contractName
  private orderbooks: Map<string, LocalOrderbook> = new Map(); // contractId -> orderbook
  private pingInterval: number | null = null;
  private reconnectTimer: number | null = null;
  private sessions: Set<WebSocket> = new Set();
  private isTracking: boolean = false;
  private messagesReceived: number = 0;
  private lastMessageAt: number = 0;
  private aggregator: OrderBookAggregator | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    console.log(`[EdgeX] 🎬 Durable Object created`);

    // Load tracking state - AUTO-START by default
    this.ctx.blockConcurrencyWhile(async () => {
      const storedState = await this.ctx.storage.get<boolean>('isTracking');
      // Auto-start if never set before (undefined), otherwise use stored state
      this.isTracking = storedState !== undefined ? storedState : true;
      console.log(`[EdgeX] 📂 Loaded state: isTracking=${this.isTracking} (stored=${storedState})`);

      // Persist the auto-start state if this is first time
      if (storedState === undefined) {
        await this.ctx.storage.put('isTracking', true);
      }

      // Auto-start tracking if enabled (MUST be inside blockConcurrencyWhile!)
      if (this.isTracking) {
        console.log(`[EdgeX] ▶️ Auto-starting tracking...`);
        this.initialize();
      }
    });
  }

  /**
   * Initialisierung
   */
  async initialize(): Promise<void> {
    console.log(`[EdgeX] 🔧 Initializing...`);

    // Aggregator erstellen
    this.aggregator = new OrderBookAggregator(this.env.DB, 'edgex');

    // Markets laden
    await this.loadMarkets();

    // WebSocket verbinden
    this.connectWebSocket();

    console.log(`[EdgeX] ✅ Initialized`);
  }

  /**
   * Load markets from edgeX API
   */
  async loadMarkets(): Promise<void> {
    console.log(`[EdgeX] 🔍 Loading markets from API...`);

    try {
      const response = await fetch('https://pro.edgex.exchange/api/v1/public/meta/getMetaData', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EdgeXTracker/1.0)',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.data || !data.data.contractList || !Array.isArray(data.data.contractList)) {
        throw new Error('Invalid API response format');
      }

      console.log(`[EdgeX] 📋 Received ${data.data.contractList.length} contracts from API`);

      // Store all contracts
      for (const contract of data.data.contractList) {
        const contractId = contract.contractId.toString();
        const contractName = contract.contractName;
        this.markets.set(contractId, contractName);
      }

      // Batch insert to database
      const statements = Array.from(this.markets.entries()).map(([contractId, contractName]) => {
        return this.env.DB.prepare(
          `INSERT OR REPLACE INTO edgex_markets (contract_id, contract_name, last_updated)
           VALUES (?, ?, ?)`
        ).bind(contractId, contractName, Date.now());
      });

      // Batch insert (max 50 per batch)
      const batches = this.chunkArray(statements, 50);
      for (const batch of batches) {
        await this.env.DB.batch(batch);
      }

      console.log(`[EdgeX] ✅ Loaded ${this.markets.size} contracts`);
      console.log(`[EdgeX] 📊 Sample contracts:`, Array.from(this.markets.entries()).slice(0, 5));

    } catch (error) {
      console.error(`[EdgeX] ❌ Failed to load markets:`, error);
      throw error;
    }
  }

  /**
   * Connect to edgeX WebSocket
   */
  connectWebSocket(): void {
    if (this.ws) {
      console.log(`[EdgeX] ⚠️ WebSocket already exists`);
      return;
    }

    console.log(`[EdgeX] 🔌 Connecting to WebSocket...`);

    try {
      this.ws = new WebSocket('wss://quote.edgex.exchange/api/v1/public/ws');

      this.ws.addEventListener('open', () => {
        console.log(`[EdgeX] ✅ WebSocket connected`);
        this.startPing();
        this.subscribeAllMarkets();
      });

      this.ws.addEventListener('message', (event) => {
        this.handleMessage(event.data as string);
      });

      this.ws.addEventListener('close', (event) => {
        console.log(`[EdgeX] 🔌 WebSocket closed (code: ${event.code})`);
        this.ws = null;
        this.stopPing();
        this.scheduleReconnect();
      });

      this.ws.addEventListener('error', (event) => {
        console.error(`[EdgeX] ❌ WebSocket error:`, event);
      });

    } catch (error) {
      console.error(`[EdgeX] ❌ Failed to create WebSocket:`, error);
      this.scheduleReconnect();
    }
  }

  /**
   * Subscribe to all markets
   */
  subscribeAllMarkets(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log(`[EdgeX] ⚠️ Cannot subscribe - WebSocket not open`);
      return;
    }

    console.log(`[EdgeX] 📡 Subscribing to ${this.markets.size} markets...`);

    let subscribed = 0;
    for (const [contractId, contractName] of this.markets) {
      try {
        const subscription = {
          type: 'subscribe',
          channel: `depth.${contractId}.15`
        };
        this.ws.send(JSON.stringify(subscription));
        subscribed++;
      } catch (error) {
        console.error(`[EdgeX] ❌ Failed to subscribe to ${contractName}:`, error);
      }
    }

    console.log(`[EdgeX] ✅ Subscribed to ${subscribed} markets`);
  }

  /**
   * Handle incoming WebSocket message
   */
  handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      this.messagesReceived++;
      this.lastMessageAt = Date.now();

      // Handle quote-event messages
      if (message.type === 'quote-event' && message.content?.data) {
        for (const depthData of message.content.data) {
          this.handleDepthUpdate(depthData);
        }
      }

      // Broadcast to all connected dashboard clients
      this.broadcast({
        type: 'message',
        data: message
      });

    } catch (error) {
      console.error(`[EdgeX] ❌ Failed to parse message:`, error);
    }
  }

  /**
   * Handle depth update (SNAPSHOT or CHANGED)
   */
  handleDepthUpdate(depthData: any): void {
    const contractId = depthData.contractId?.toString();
    if (!contractId) return;

    const contractName = this.markets.get(contractId);
    if (!contractName) return;

    const depthType = depthData.depthType;

    // Get or create local orderbook
    let orderbook = this.orderbooks.get(contractId);
    if (!orderbook) {
      orderbook = { bids: new Map(), asks: new Map() };
      this.orderbooks.set(contractId, orderbook);
    }

    // Handle SNAPSHOT - full orderbook
    if (depthType === 'SNAPSHOT') {
      orderbook.bids.clear();
      orderbook.asks.clear();

      // Add all bids
      if (depthData.bids) {
        for (const bid of depthData.bids) {
          const price = parseFloat(bid.price);
          const size = parseFloat(bid.size);
          if (size > 0) {
            orderbook.bids.set(price, size);
          }
        }
      }

      // Add all asks
      if (depthData.asks) {
        for (const ask of depthData.asks) {
          const price = parseFloat(ask.price);
          const size = parseFloat(ask.size);
          if (size > 0) {
            orderbook.asks.set(price, size);
          }
        }
      }
    }
    // Handle CHANGED - incremental update
    else if (depthType === 'CHANGED') {
      // Update bids
      if (depthData.bids) {
        for (const bid of depthData.bids) {
          const price = parseFloat(bid.price);
          const size = parseFloat(bid.size);
          if (size > 0) {
            orderbook.bids.set(price, size);
          } else {
            orderbook.bids.delete(price); // Remove if size is 0
          }
        }
      }

      // Update asks
      if (depthData.asks) {
        for (const ask of depthData.asks) {
          const price = parseFloat(ask.price);
          const size = parseFloat(ask.size);
          if (size > 0) {
            orderbook.asks.set(price, size);
          } else {
            orderbook.asks.delete(price); // Remove if size is 0
          }
        }
      }
    }

    // Process orderbook for aggregation
    this.processOrderbook(contractId, contractName, orderbook);
  }

  /**
   * Process orderbook and send to aggregator
   */
  processOrderbook(contractId: string, contractName: string, orderbook: LocalOrderbook): void {
    // Sort and get best bid and ask
    const sortedBids = Array.from(orderbook.bids.entries())
      .sort((a, b) => b[0] - a[0]); // Descending

    const sortedAsks = Array.from(orderbook.asks.entries())
      .sort((a, b) => a[0] - b[0]); // Ascending

    if (sortedBids.length === 0 && sortedAsks.length === 0) {
      return; // Skip if no data
    }

    // Get best bid and ask prices
    const bestBid = sortedBids.length > 0 ? sortedBids[0][0] : null;
    const bestAsk = sortedAsks.length > 0 ? sortedAsks[0][0] : null;

    // Send to aggregator (uses contractName as symbol)
    if (this.aggregator) {
      this.aggregator.processUpdate(contractName, bestBid, bestAsk);
    }
  }

  /**
   * Start ping interval
   */
  startPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error(`[EdgeX] ❌ Failed to send ping:`, error);
        }
      }
    }, 30000) as unknown as number;
  }

  /**
   * Stop ping interval
   */
  stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Schedule reconnect
   */
  scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    if (this.isTracking) {
      console.log(`[EdgeX] 🔄 Reconnecting in 5 seconds...`);
      this.reconnectTimer = setTimeout(() => {
        this.connectWebSocket();
      }, 5000) as unknown as number;
    }
  }

  /**
   * Start tracking (called from dashboard)
   */
  async startTracking(): Promise<any> {
    if (this.isTracking) {
      return { success: false, message: 'Already tracking' };
    }

    console.log(`[EdgeX] 🚀 Starting tracker...`);

    try {
      // Initialize
      await this.initialize();

      this.isTracking = true;
      await this.ctx.storage.put('isTracking', true);

      console.log(`[EdgeX] ✅ Tracking started`);

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
      console.error(`[EdgeX] ❌ Failed to start:`, error);
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

    console.log(`[EdgeX] 🛑 Stopping tracker...`);

    this.isTracking = false;
    await this.ctx.storage.put('isTracking', false);

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Stop intervals
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Stop aggregator
    if (this.aggregator) {
      this.aggregator.stop();
      this.aggregator = null;
    }

    console.log(`[EdgeX] ✅ Tracking stopped`);

    this.broadcast({
      type: 'status',
      data: { isTracking: false }
    });

    return {
      success: true,
      message: 'Tracking stopped'
    };
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<any> {
    const snapshotCount = await this.env.DB.prepare(
      "SELECT COUNT(*) as count FROM orderbook_snapshots WHERE source = 'edgex'"
    ).first();

    const minuteCount = await this.env.DB.prepare(
      "SELECT COUNT(*) as count FROM orderbook_minutes WHERE source = 'edgex'"
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
   * Broadcast message to all connected clients
   */
  broadcast(message: any): void {
    const data = JSON.stringify(message);
    for (const session of this.sessions) {
      try {
        session.send(data);
      } catch (error) {
        console.error(`[EdgeX] ❌ Failed to send to client:`, error);
        this.sessions.delete(session);
      }
    }
  }

  /**
   * Chunk array into smaller arrays
   */
  chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Handle HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle internal ensure-running ping (wakes up DO and ensures tracking is active)
    if (url.pathname === '/ensure-running') {
      console.log(`[EdgeX] 🔍 Ensure-running check: isTracking=${this.isTracking}`);

      // Auto-start if not already tracking
      if (!this.isTracking) {
        console.log(`[EdgeX] 🚀 Auto-starting from ensure-running...`);
        try {
          await this.initialize();
          this.isTracking = true;
          await this.ctx.storage.put('isTracking', true);
          console.log(`[EdgeX] ✅ Auto-start successful`);
        } catch (error) {
          console.error(`[EdgeX] ❌ Auto-start failed:`, error);
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

    // Handle stats request
    if (url.pathname === '/stats') {
      const stats = await this.getStats();
      return new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle start request
    if (url.pathname === '/start') {
      const result = await this.startTracking();
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle stop request
    if (url.pathname === '/stop') {
      const result = await this.stopTracking();
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // MUST call accept() BEFORE sending any messages
      server.accept();
      this.sessions.add(server);

      console.log(`[EdgeX] 👤 Client connected (${this.sessions.size} total)`);

      // Send initial stats
      const stats = await this.getStats();
      server.send(JSON.stringify({ type: 'stats', data: stats }));

      // Handle disconnect
      server.addEventListener('close', () => {
        this.sessions.delete(server);
        console.log(`[EdgeX] 👋 Client disconnected (${this.sessions.size} remaining)`);
      });

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    return new Response('Not found', { status: 404 });
  }
}

/**
 * Local orderbook state
 */
interface LocalOrderbook {
  bids: Map<number, number>; // price -> size
  asks: Map<number, number>; // price -> size
}
