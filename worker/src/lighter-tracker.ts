/**
 * Lighter Exchange Tracker - Separate Durable Object
 * Handles only Lighter WebSocket connection and data storage
 */

export interface Env {
  DB: D1Database;
}

export class LighterTracker {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Set<WebSocket>;

  // Lighter WebSocket
  private ws: WebSocket | null = null;
  private pingInterval: any = null;
  private reconnectTimeout: any = null;

  // Tracked markets
  private markets: Set<string> = new Set();
  private tokenMappings: Map<string, any> = new Map();

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

    if (this.isTracking) {
      this.initialize();
    }
  }

  async initialize() {
    await this.loadTokenMappings();
    await this.discoverMarkets();
    await this.connect();
  }

  async loadTokenMappings() {
    try {
      const result = await this.env.DB.prepare(
        `SELECT * FROM token_mapping WHERE source = 'lighter' AND active = 1`
      ).all();

      for (const row of result.results || []) {
        const key = `${row.market_id}`;
        this.tokenMappings.set(key, row);
      }

      console.log(`[Lighter] Loaded ${this.tokenMappings.size} token mappings`);
    } catch (error) {
      console.error('[Lighter] Error loading token mappings:', error);
    }
  }

  async discoverMarkets() {
    try {
      console.log('[Lighter] 🔍 Discovering markets...');
      const response = await fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBooks');

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.code === 200 && data.order_books) {
        console.log(`[Lighter] ✅ Found ${data.order_books.length} total markets`);

        for (const market of data.order_books) {
          if (market.status === 'active') {
            this.markets.add(market.market_id);
            await this.ensureTokenMapping(market.market_id, market.symbol);
          }
        }
        console.log(`[Lighter] 📚 Tracking ${this.markets.size} active markets`);
      } else {
        console.error('[Lighter] ❌ Invalid API response');
        throw new Error('Invalid API response from Lighter');
      }
    } catch (error) {
      console.error('[Lighter] ❌ Error discovering markets:', error);
      this.broadcast({
        type: 'error',
        data: { exchange: 'lighter', message: 'Failed to discover markets' }
      });
      throw error; // Re-throw to stop initialization
    }
  }

  async ensureTokenMapping(marketId: string, symbol: string) {
    const key = marketId;

    if (!this.tokenMappings.has(key)) {
      try {
        // Extract base asset from symbol (e.g., "ETH/USDC" → "ETH", "BTC-USDC" → "BTC")
        const baseAsset = symbol.split(/[\/\-]/)[0];
        const parts = symbol.split(/[\/\-]/);
        const quoteAsset = parts[1] || 'USD';

        await this.env.DB.prepare(
          `INSERT OR IGNORE INTO token_mapping
           (source, original_symbol, normalized_symbol, base_asset, quote_asset, market_type, active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`
        ).bind('lighter', marketId, baseAsset, baseAsset, quoteAsset, 'PERP').run();

        this.tokenMappings.set(key, {
          source: 'lighter',
          original_symbol: marketId,
          normalized_symbol: baseAsset,
          base_asset: baseAsset,
          quote_asset: quoteAsset,
          market_type: 'PERP',
          active: 1
        });
      } catch (error) {
        console.error('[Lighter] Error creating token mapping:', error);
      }
    }
  }

  getNormalizedSymbol(marketId: string): string {
    const mapping = this.tokenMappings.get(marketId);
    return mapping?.normalized_symbol || marketId;
  }

  async connect() {
    try {
      console.log('[Lighter] 🔄 Connecting to WebSocket...');
      const ws = new WebSocket('wss://mainnet.zklighter.elliot.ai/stream');

      ws.addEventListener('open', () => {
        console.log('[Lighter] ✅ Connected to WebSocket');
        console.log(`[Lighter] 📊 Subscribing to ${this.markets.size} markets`);

        for (const marketId of this.markets) {
          this.subscribe(marketId);
        }

        this.startPing();
      });

      ws.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      ws.addEventListener('close', (event) => {
        console.log(`[Lighter] ❌ Disconnected (code: ${event.code}, reason: ${event.reason})`);
        this.ws = null;
        this.stopPing();

        // Only reconnect if still tracking
        if (this.isTracking) {
          console.log('[Lighter] 🔄 Reconnecting in 5 seconds...');
          this.reconnectTimeout = setTimeout(() => {
            this.connect();
          }, 5000);
        } else {
          console.log('[Lighter] ⏸️ Not reconnecting (tracking stopped)');
        }
      });

      ws.addEventListener('error', (error: any) => {
        console.error('[Lighter] ❌ WebSocket error:', error);
        this.broadcast({
          type: 'error',
          data: { exchange: 'lighter', message: 'WebSocket connection error' }
        });
      });

      this.ws = ws;
    } catch (error) {
      console.error('[Lighter] ❌ Failed to connect:', error);
      this.broadcast({
        type: 'error',
        data: { exchange: 'lighter', message: 'Failed to initialize connection' }
      });
    }
  }

  subscribe(marketId: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        channel: `order_book/${marketId}`
      }));
      console.log(`[Lighter] 📚 Subscribed to order_book/${marketId}`);
    }
  }

  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  async handleMessage(data: string) {
    try {
      const message = JSON.parse(data);

      if (message.channel && message.channel.startsWith('order_book:')) {
        const marketId = message.channel.replace('order_book:', '');
        await this.saveOrderbookUpdate(marketId, message);
      }
    } catch (error) {
      console.error('[Lighter] Error parsing message:', error);
    }
  }

  async saveOrderbookUpdate(marketId: string, message: any) {
    try {
      const { order_book, timestamp } = message;
      if (!order_book) return;

      const { asks, bids, offset, nonce } = order_book;
      const normalizedSymbol = this.getNormalizedSymbol(marketId);

      // Best price only (1 ask, 1 bid)
      const limitedAsks = asks?.slice(0, 1) || [];
      const limitedBids = bids?.slice(0, 1) || [];

      if (limitedAsks.length > 0 || limitedBids.length > 0) {
        const values: string[] = [];
        const bindings: any[] = [];

        for (const ask of limitedAsks) {
          values.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
          bindings.push(
            'lighter', marketId, normalizedSymbol, 'ask',
            parseFloat(ask.price), parseFloat(ask.size),
            timestamp, offset, nonce
          );
        }

        for (const bid of limitedBids) {
          values.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
          bindings.push(
            'lighter', marketId, normalizedSymbol, 'bid',
            parseFloat(bid.price), parseFloat(bid.size),
            timestamp, offset, nonce
          );
        }

        const query = `INSERT INTO orderbook_entries
          (source, market_id, normalized_symbol, side, price, size, timestamp, offset, nonce)
          VALUES ${values.join(', ')}`;

        await this.env.DB.prepare(query).bind(...bindings).run();
      }
    } catch (error) {
      console.error('[Lighter] Error saving orderbook:', error);
    }
  }

  async startTracking() {
    if (this.isTracking) {
      return { success: false, message: 'Already tracking' };
    }

    try {
      this.isTracking = true;
      await this.state.storage.put('isTracking', true);

      console.log('[Lighter] ▶️ Starting tracking...');
      await this.initialize();

      console.log('[Lighter] ✅ Tracking started successfully');
      this.broadcast({ type: 'tracking_status', data: { exchange: 'lighter', isTracking: true } });

      return { success: true, message: 'Lighter tracking started' };
    } catch (error) {
      console.error('[Lighter] ❌ Failed to start tracking:', error);
      this.isTracking = false;
      await this.state.storage.put('isTracking', false);

      this.broadcast({
        type: 'error',
        data: { exchange: 'lighter', message: 'Failed to start tracking: ' + (error as Error).message }
      });

      return { success: false, message: 'Failed to start tracking: ' + (error as Error).message };
    }
  }

  async stopTracking() {
    if (!this.isTracking) {
      return { success: false, message: 'Already stopped' };
    }

    this.isTracking = false;
    await this.state.storage.put('isTracking', false);

    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.stopPing();

    console.log('[Lighter] ⏸️ Stopped tracking');
    this.broadcast({ type: 'tracking_status', data: { exchange: 'lighter', isTracking: false } });

    return { success: true, message: 'Lighter tracking stopped' };
  }

  async getStats() {
    return {
      exchange: 'lighter',
      markets: this.markets.size,
      connected: this.ws?.readyState === WebSocket.OPEN,
      isTracking: this.isTracking
    };
  }

  // WebSocket handling
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
        console.error('[Lighter] Error handling message:', error);
      }
    });

    websocket.addEventListener('close', () => {
      this.sessions.delete(websocket);
    });

    // Send current stats
    const stats = await this.getStats();
    websocket.send(JSON.stringify({ type: 'stats', data: stats }));
  }

  async handleClientMessage(data: any, websocket: WebSocket) {
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

  broadcast(message: any) {
    const data = JSON.stringify(message);
    for (const session of this.sessions) {
      try {
        session.send(data);
      } catch (error) {
        console.error('[Lighter] Error broadcasting:', error);
      }
    }
  }
}
