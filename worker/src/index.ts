/**
 * Lighter Price Monitor v2 - Persistent Background Monitoring
 * Mit D1 Database für Alert-Historie und dauerhafte Überwachung
 */

export interface Env {
  PRICE_MONITOR: DurableObjectNamespace;
  DB: D1Database;
}

// Durable Object für persistente Überwachung
export class PriceMonitor {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Set<WebSocket>;
  private monitoredTokens: Map<string, TokenMonitor>;
  private lighterWs: WebSocket | null = null;
  private reconnectTimeout: any = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
    this.monitoredTokens = new Map();
    
    // Lade gespeicherte Monitore beim Start
    this.loadMonitorsFromStorage();
  }

  async loadMonitorsFromStorage() {
    const stored = await this.state.storage.list<TokenMonitor>({ prefix: 'monitor:' });
    for (const [key, monitor] of stored) {
      this.monitoredTokens.set(monitor.tokenId, monitor);
    }
    
    // Starte Lighter-Verbindung wenn Monitore existieren
    if (this.monitoredTokens.size > 0 && !this.lighterWs) {
      await this.connectToLighter();
    }
  }

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

    // Verbindung zu Lighter herstellen, falls noch nicht geschehen
    if (!this.lighterWs && this.monitoredTokens.size > 0) {
      await this.connectToLighter();
    }

    websocket.addEventListener('message', async (msg) => {
      try {
        const data = JSON.parse(msg.data as string);
        await this.handleClientMessage(data, websocket);
      } catch (error) {
        console.error('Error handling message:', error);
        websocket.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        }));
      }
    });

    websocket.addEventListener('close', () => {
      this.sessions.delete(websocket);
      // WICHTIG: Lighter-Verbindung NICHT schließen!
      // Monitoring läuft weiter, auch ohne aktive Clients
    });

    // Sende aktuelle Monitore und Alerts an neuen Client
    await this.sendCurrentState(websocket);
  }

  async connectToLighter() {
    try {
      const ws = new WebSocket('wss://mainnet.zklighter.elliot.ai/stream');
      
      ws.addEventListener('open', () => {
        console.log('Connected to Lighter WebSocket');

        // Abonniere alle überwachten Token
        for (const [tokenId, monitor] of this.monitoredTokens) {
          this.subscribeTicker(tokenId);
          if (monitor.trackOrderbook) {
            this.subscribeOrderbook(tokenId);
          }
        }
      });

      ws.addEventListener('message', (event) => {
        this.handleLighterMessage(event.data);
      });

      ws.addEventListener('close', () => {
        console.log('Disconnected from Lighter');
        this.lighterWs = null;
        
        // Auto-Reconnect - IMMER, wenn noch Monitore existieren
        if (this.monitoredTokens.size > 0) {
          this.reconnectTimeout = setTimeout(() => {
            this.connectToLighter();
          }, 5000);
        }
      });

      ws.addEventListener('error', (error: any) => {
        console.error('Lighter WebSocket error:', {
          message: error?.message,
          type: error?.type,
          error: JSON.stringify(error, Object.getOwnPropertyNames(error))
        });
      });

      this.lighterWs = ws;
    } catch (error) {
      console.error('Failed to connect to Lighter:', error);
    }
  }

  disconnectFromLighter() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.lighterWs) {
      this.lighterWs.close();
      this.lighterWs = null;
    }
  }

  subscribeTicker(tokenId: string) {
    if (this.lighterWs && this.lighterWs.readyState === WebSocket.OPEN) {
      const subscribeMsg = {
        type: 'subscribe',
        channel: `market_stats/${tokenId}`  // Request mit Slash
      };
      console.log(`📡 Subscribing to market_stats/${tokenId}`);
      this.lighterWs.send(JSON.stringify(subscribeMsg));
    }
  }

  unsubscribeTicker(tokenId: string) {
    if (this.lighterWs && this.lighterWs.readyState === WebSocket.OPEN) {
      const unsubscribeMsg = {
        type: 'unsubscribe',
        channel: `market_stats/${tokenId}`  // Request mit Slash
      };
      console.log(`📡 Unsubscribing from market_stats/${tokenId}`);
      this.lighterWs.send(JSON.stringify(unsubscribeMsg));
    }
  }

  subscribeOrderbook(tokenId: string) {
    if (this.lighterWs && this.lighterWs.readyState === WebSocket.OPEN) {
      const subscribeMsg = {
        type: 'subscribe',
        channel: `order_book/${tokenId}`
      };
      console.log(`📚 Subscribing to order_book/${tokenId}`);
      this.lighterWs.send(JSON.stringify(subscribeMsg));
    }
  }

  unsubscribeOrderbook(tokenId: string) {
    if (this.lighterWs && this.lighterWs.readyState === WebSocket.OPEN) {
      const unsubscribeMsg = {
        type: 'unsubscribe',
        channel: `order_book/${tokenId}`
      };
      console.log(`📚 Unsubscribing from order_book/${tokenId}`);
      this.lighterWs.send(JSON.stringify(unsubscribeMsg));
    }
  }

  handleLighterMessage(data: string) {
    try {
      const message = JSON.parse(data);

      // DEBUG: Logge alle Nachrichten von Lighter
      console.log('📩 Lighter message:', JSON.stringify(message));

      // Market Stats Updates
      if (message.channel && message.channel.startsWith('market_stats:')) {
        const marketId = message.channel.replace('market_stats:', '');
        const price = parseFloat(message.market_stats?.mark_price || message.market_stats?.index_price);

        console.log(`💰 Price update for market ${marketId} (${message.market_stats?.symbol}):`, price);

        if (price && this.monitoredTokens.has(marketId)) {
          this.checkPriceThreshold(marketId, price);
        }
      }

      // Orderbook Updates
      if (message.channel && message.channel.startsWith('order_book:')) {
        const marketId = message.channel.replace('order_book:', '');

        if (this.monitoredTokens.has(marketId)) {
          const monitor = this.monitoredTokens.get(marketId);
          if (monitor?.trackOrderbook) {
            this.saveOrderbookUpdate(marketId, message);
          }
        }
      }
    } catch (error) {
      console.error('Error parsing Lighter message:', error);
    }
  }

  async checkPriceThreshold(tokenId: string, currentPrice: number) {
    const monitor = this.monitoredTokens.get(tokenId);
    if (!monitor) return;

    const triggered = 
      (monitor.type === 'above' && currentPrice > monitor.threshold) ||
      (monitor.type === 'below' && currentPrice < monitor.threshold);

    // Update Monitor-Preis
    monitor.lastPrice = currentPrice;
    monitor.lastUpdate = Date.now();
    await this.state.storage.put(`monitor:${tokenId}`, monitor);

    // Wenn Schwellwert erreicht: Alert speichern!
    if (triggered) {
      const alert: PriceAlert = {
        id: `${tokenId}_${Date.now()}`,
        tokenId,
        currentPrice,
        threshold: monitor.threshold,
        type: monitor.type,
        timestamp: Date.now(),
        triggered: true
      };

      // In D1 Database speichern
      await this.saveAlertToDatabase(alert);

      // Broadcast an alle verbundenen Clients
      this.broadcast({
        type: 'price_alert',
        data: alert
      });
    }

    // Sende Preis-Update an Clients (auch wenn nicht triggered)
    this.broadcast({
      type: 'price_update',
      data: {
        tokenId,
        currentPrice,
        lastUpdate: monitor.lastUpdate
      }
    });
  }

  async saveAlertToDatabase(alert: PriceAlert) {
    try {
      await this.env.DB.prepare(
        `INSERT INTO alerts (id, token_id, current_price, threshold, type, timestamp, triggered)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        alert.id,
        alert.tokenId,
        alert.currentPrice,
        alert.threshold,
        alert.type,
        alert.timestamp,
        alert.triggered ? 1 : 0
      ).run();
    } catch (error) {
      console.error('Error saving alert to database:', error);
    }
  }

  async saveOrderbookUpdate(marketId: string, message: any) {
    try {
      const { order_book, timestamp } = message;
      if (!order_book) return;

      const { asks, bids, offset, nonce } = order_book;

      // Speichere Asks
      if (asks && Array.isArray(asks)) {
        for (const ask of asks) {
          const price = parseFloat(ask.price);
          const size = parseFloat(ask.size);

          await this.env.DB.prepare(
            `INSERT INTO orderbook_entries (market_id, side, price, size, timestamp, offset, nonce)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(marketId, 'ask', price, size, timestamp, offset, nonce).run();
        }
      }

      // Speichere Bids
      if (bids && Array.isArray(bids)) {
        for (const bid of bids) {
          const price = parseFloat(bid.price);
          const size = parseFloat(bid.size);

          await this.env.DB.prepare(
            `INSERT INTO orderbook_entries (market_id, side, price, size, timestamp, offset, nonce)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(marketId, 'bid', price, size, timestamp, offset, nonce).run();
        }
      }

      console.log(`📚 Saved orderbook update for market ${marketId}: ${asks?.length || 0} asks, ${bids?.length || 0} bids`);
    } catch (error) {
      console.error('Error saving orderbook to database:', error);
    }
  }

  async handleClientMessage(data: any, websocket: WebSocket) {
    switch (data.type) {
      case 'add_monitor':
        await this.addMonitor(data.tokenId, data.threshold, data.monitorType, data.trackOrderbook || false);
        break;

      case 'remove_monitor':
        await this.removeMonitor(data.tokenId);
        break;

      case 'get_state':
        await this.sendCurrentState(websocket);
        break;

      case 'get_alerts':
        await this.sendAlertHistory(websocket, data.limit || 100);
        break;

      case 'clear_alerts':
        await this.clearAlerts(data.tokenId);
        websocket.send(JSON.stringify({
          type: 'alerts_cleared',
          data: { tokenId: data.tokenId }
        }));
        break;
    }
  }

  async addMonitor(tokenId: string, threshold: number, type: 'above' | 'below', trackOrderbook: boolean = false) {
    const monitor: TokenMonitor = {
      tokenId,
      threshold,
      type,
      lastPrice: null,
      lastUpdate: null,
      createdAt: Date.now(),
      enabled: true,
      trackOrderbook
    };

    this.monitoredTokens.set(tokenId, monitor);

    // Persistent speichern
    await this.state.storage.put(`monitor:${tokenId}`, monitor);

    // Lighter-Verbindung starten falls noch nicht aktiv
    if (!this.lighterWs) {
      await this.connectToLighter();
    } else {
      // Abonniere Token
      this.subscribeTicker(tokenId);
      if (trackOrderbook) {
        this.subscribeOrderbook(tokenId);
      }
    }

    // Benachrichtige alle Clients
    this.broadcast({
      type: 'monitor_added',
      data: monitor
    });
  }

  async removeMonitor(tokenId: string) {
    const monitor = this.monitoredTokens.get(tokenId);

    this.monitoredTokens.delete(tokenId);
    await this.state.storage.delete(`monitor:${tokenId}`);
    this.unsubscribeTicker(tokenId);

    // Unsubscribe Orderbook falls aktiv
    if (monitor?.trackOrderbook) {
      this.unsubscribeOrderbook(tokenId);
    }

    // Wenn keine Monitore mehr: Lighter-Verbindung schließen
    if (this.monitoredTokens.size === 0) {
      this.disconnectFromLighter();
    }

    this.broadcast({
      type: 'monitor_removed',
      data: { tokenId }
    });
  }

  async sendCurrentState(websocket: WebSocket) {
    const monitors = Array.from(this.monitoredTokens.values());
    websocket.send(JSON.stringify({
      type: 'current_state',
      data: {
        monitors,
        connected: this.lighterWs?.readyState === WebSocket.OPEN
      }
    }));
  }

  async sendAlertHistory(websocket: WebSocket, limit: number = 100) {
    try {
      const result = await this.env.DB.prepare(
        `SELECT * FROM alerts 
         ORDER BY timestamp DESC 
         LIMIT ?`
      ).bind(limit).all();

      websocket.send(JSON.stringify({
        type: 'alert_history',
        data: result.results || []
      }));
    } catch (error) {
      console.error('Error fetching alert history:', error);
      websocket.send(JSON.stringify({
        type: 'alert_history',
        data: []
      }));
    }
  }

  async clearAlerts(tokenId?: string) {
    try {
      if (tokenId) {
        await this.env.DB.prepare(
          `DELETE FROM alerts WHERE token_id = ?`
        ).bind(tokenId).run();
      } else {
        await this.env.DB.prepare(
          `DELETE FROM alerts`
        ).run();
      }
    } catch (error) {
      console.error('Error clearing alerts:', error);
    }
  }

  broadcast(message: any) {
    const data = JSON.stringify(message);
    for (const session of this.sessions) {
      try {
        session.send(data);
      } catch (error) {
        console.error('Error broadcasting to session:', error);
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
      const id = env.PRICE_MONITOR.idFromName('price-monitor');
      const stub = env.PRICE_MONITOR.get(id);
      return stub.fetch(request);
    }

    // HTTP API: Alert-Historie abrufen
    if (url.pathname === '/api/alerts') {
      try {
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const result = await env.DB.prepare(
          `SELECT * FROM alerts 
           ORDER BY timestamp DESC 
           LIMIT ?`
        ).bind(limit).all();

        return new Response(JSON.stringify(result.results), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Database error' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Statische Info-Seite
    if (url.pathname === '/') {
      return new Response('Lighter Price Monitor v2 - Persistent Background Monitoring', {
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};

// Type Definitions
interface TokenMonitor {
  tokenId: string;
  threshold: number;
  type: 'above' | 'below';
  lastPrice: number | null;
  lastUpdate: number | null;
  createdAt: number;
  enabled: boolean;
  trackOrderbook: boolean;  // NEU: Orderbook-Tracking aktiviert?
}

interface PriceAlert {
  id: string;
  tokenId: string;
  currentPrice: number;
  threshold: number;
  type: 'above' | 'below';
  timestamp: number;
  triggered: boolean;
}
