/**
 * Paradex Exchange Tracker - Separate Durable Object
 * Handles only Paradex WebSocket connection and data storage
 */

import { OrderBookAggregator } from './aggregator';

export interface Env {
  DB: D1Database;
}

export class ParadexTracker {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Set<WebSocket>;

  // Paradex WebSocket
  private ws: WebSocket | null = null;
  private pingInterval: any = null;
  private reconnectTimeout: any = null;

  // Tracked markets
  private markets: Set<string> = new Set();
  private tokenMappings: Map<string, any> = new Map();

  // Tracking state
  private isTracking: boolean = false;

  // Aggregator for memory-efficient data storage
  private aggregator: OrderBookAggregator | null = null;

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
    // Initialisiere Aggregator
    this.aggregator = new OrderBookAggregator(this.env.DB, 'paradex');

    await this.loadTokenMappings();
    await this.discoverMarkets();
    await this.connect();
  }

  async loadTokenMappings() {
    try {
      const result = await this.env.DB.prepare(
        `SELECT * FROM token_mapping WHERE source = 'paradex' AND active = 1`
      ).all();

      for (const row of result.results || []) {
        const key = `${row.original_symbol}`;
        this.tokenMappings.set(key, row);
      }

      console.log(`[Paradex] Loaded ${this.tokenMappings.size} token mappings`);
    } catch (error) {
      console.error('[Paradex] Error loading token mappings:', error);
    }
  }

  async discoverMarkets() {
    try {
      console.log('[Paradex] 🔍 Discovering markets...');
      const response = await fetch('https://api.prod.paradex.trade/v1/markets');

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.results) {
        // Only PERP markets, exclude OPTIONS
        const perpMarkets = data.results.filter((m: any) =>
          m.market_type === 'PERP' && !m.symbol.includes('OPTION')
        );

        console.log(`[Paradex] ✅ Found ${perpMarkets.length} PERP markets`);

        for (const market of perpMarkets) {
          this.markets.add(market.symbol);

          const baseAsset = market.symbol.split('-')[0];
          await this.ensureTokenMapping(market.symbol, baseAsset);
        }
        console.log(`[Paradex] 📚 Tracking ${this.markets.size} markets total`);
      } else {
        console.error('[Paradex] ❌ No results in API response');
        throw new Error('No markets found in API response');
      }
    } catch (error) {
      console.error('[Paradex] ❌ Error discovering markets:', error);
      this.broadcast({
        type: 'error',
        data: { exchange: 'paradex', message: 'Failed to discover markets' }
      });
      throw error; // Re-throw to stop initialization
    }
  }

  async ensureTokenMapping(symbol: string, baseAsset: string) {
    const key = symbol;

    if (!this.tokenMappings.has(key)) {
      try {
        const parts = symbol.split('-');
        const quoteAsset = parts[1] || 'USD';
        const marketType = parts[2] || 'PERP';

        await this.env.DB.prepare(
          `INSERT OR IGNORE INTO token_mapping
           (source, original_symbol, normalized_symbol, base_asset, quote_asset, market_type, active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`
        ).bind('paradex', symbol, baseAsset, baseAsset, quoteAsset, marketType).run();

        this.tokenMappings.set(key, {
          source: 'paradex',
          original_symbol: symbol,
          normalized_symbol: baseAsset,
          base_asset: baseAsset,
          quote_asset: quoteAsset,
          market_type: marketType,
          active: 1
        });
      } catch (error) {
        console.error('[Paradex] Error creating token mapping:', error);
      }
    }
  }

  getNormalizedSymbol(symbol: string): string {
    const mapping = this.tokenMappings.get(symbol);
    return mapping?.normalized_symbol || symbol;
  }

  async connect() {
    try {
      console.log('[Paradex] 🔄 Connecting to WebSocket...');
      const ws = new WebSocket('wss://ws.api.prod.paradex.trade/v1');

      ws.addEventListener('open', () => {
        console.log('[Paradex] ✅ Connected to WebSocket');
        console.log(`[Paradex] 📊 Subscribing to ${this.markets.size} markets`);

        for (const market of this.markets) {
          this.subscribeOrderbook(market);
        }
        this.subscribeTrades();
        this.startPing();
      });

      ws.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      ws.addEventListener('close', (event) => {
        console.log(`[Paradex] ❌ Disconnected (code: ${event.code}, reason: ${event.reason})`);
        this.ws = null;
        this.stopPing();

        // Only reconnect if still tracking
        if (this.isTracking) {
          console.log('[Paradex] 🔄 Reconnecting in 5 seconds...');
          this.reconnectTimeout = setTimeout(() => {
            this.connect();
          }, 5000);
        } else {
          console.log('[Paradex] ⏸️ Not reconnecting (tracking stopped)');
        }
      });

      ws.addEventListener('error', (error: any) => {
        console.error('[Paradex] ❌ WebSocket error:', error);
        this.broadcast({
          type: 'error',
          data: { exchange: 'paradex', message: 'WebSocket connection error' }
        });
      });

      this.ws = ws;
    } catch (error) {
      console.error('[Paradex] ❌ Failed to connect:', error);
      this.broadcast({
        type: 'error',
        data: { exchange: 'paradex', message: 'Failed to initialize connection' }
      });
    }
  }

  subscribeOrderbook(market: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: {
          channel: `order_book.${market}.snapshot@15@50ms`
        },
        id: Date.now()
      }));
      console.log(`[Paradex] 📚 Subscribed to order_book.${market}`);
    }
  }

  subscribeTrades() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: {
          channel: 'trades.ALL'
        },
        id: Date.now()
      }));
      console.log('[Paradex] 📊 Subscribed to trades.ALL');
    }
  }

  startPing() {
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

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  async handleMessage(data: string) {
    try {
      const message = JSON.parse(data);

      if (message.result === 'ok') {
        return;
      }

      if (message.method === 'subscription' && message.params) {
        const { channel, data: channelData } = message.params;

        if (channel && channel.startsWith('order_book.')) {
          await this.saveOrderbookUpdate(channelData);
        }

        if (channel === 'trades.ALL') {
          await this.saveTrade(channelData);
        }
      }
    } catch (error) {
      console.error('[Paradex] Error parsing message:', error);
    }
  }

  async saveOrderbookUpdate(data: any) {
    try {
      const { market, inserts } = data;
      if (!inserts || !Array.isArray(inserts)) return;

      const normalizedSymbol = this.getNormalizedSymbol(market);

      // Extrahiere beste Bid/Ask Preise
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

      // Aggregiere statt direkt zu schreiben
      if (this.aggregator && (bestBid !== null || bestAsk !== null)) {
        this.aggregator.processUpdate(normalizedSymbol, bestBid, bestAsk);
      }
    } catch (error) {
      console.error('[Paradex] Error processing orderbook:', error);
    }
  }

  async saveTrade(data: any) {
    try {
      const { id, market, side, size, price, created_at, trade_type } = data;
      const normalizedSymbol = this.getNormalizedSymbol(market);

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
        console.log(`[Paradex] 💹 RPI Trade: ${normalizedSymbol} ${side} ${size} @ ${price}`);
      }
    } catch (error) {
      console.error('[Paradex] Error saving trade:', error);
    }
  }

  async startTracking() {
    if (this.isTracking) {
      return { success: false, message: 'Already tracking' };
    }

    try {
      this.isTracking = true;
      await this.state.storage.put('isTracking', true);

      console.log('[Paradex] ▶️ Starting tracking...');
      await this.initialize();

      console.log('[Paradex] ✅ Tracking started successfully');
      this.broadcast({ type: 'tracking_status', data: { exchange: 'paradex', isTracking: true } });

      return { success: true, message: 'Paradex tracking started' };
    } catch (error) {
      console.error('[Paradex] ❌ Failed to start tracking:', error);
      this.isTracking = false;
      await this.state.storage.put('isTracking', false);

      this.broadcast({
        type: 'error',
        data: { exchange: 'paradex', message: 'Failed to start tracking: ' + (error as Error).message }
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

    // Flush aggregator before stopping
    if (this.aggregator) {
      console.log('[Paradex] 💾 Flushing aggregator before stop...');
      await this.aggregator.forceFlush();
      this.aggregator.stopFlushTimer();
      this.aggregator = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.stopPing();

    console.log('[Paradex] ⏸️ Stopped tracking');
    this.broadcast({ type: 'tracking_status', data: { exchange: 'paradex', isTracking: false } });

    return { success: true, message: 'Paradex tracking stopped' };
  }

  async getStats() {
    return {
      exchange: 'paradex',
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
        console.error('[Paradex] Error handling message:', error);
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
        console.error('[Paradex] Error broadcasting:', error);
      }
    }
  }
}
