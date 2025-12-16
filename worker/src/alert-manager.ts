/**
 * Alert Manager - Durable Object
 *
 * Monitors arbitrage opportunities and sends alerts based on configured thresholds
 */

import { DurableObject } from 'cloudflare:workers';
import { ArbitrageCalculator } from './arbitrage';
import {
  AlertConfig,
  AlertEvent,
  AlertStateManager,
  AlertTemplates,
  DEFAULT_ALERT_CONFIGS,
  WebhookConfig
} from './alerts';

export interface Env {
  DB: D1Database;
}

export class AlertManager extends DurableObject<Env> {
  private configs: Map<string, AlertConfig>;
  private stateManager: AlertStateManager;
  private checkInterval: any = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.configs = new Map();
    this.stateManager = new AlertStateManager();
  }

  /**
   * Initialize alert manager
   */
  async initialize(): Promise<void> {
    console.log('[AlertManager] 🚀 Initializing...');

    // Load default configs
    for (const config of DEFAULT_ALERT_CONFIGS) {
      this.configs.set(config.id, config);
    }

    console.log('[AlertManager] ✅ Initialized with', this.configs.size, 'configs');
  }

  /**
   * Start periodic alert checking
   */
  startMonitoring(intervalMinutes: number = 1): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    console.log(`[AlertManager] 🔍 Starting monitoring (every ${intervalMinutes} min)`);

    this.checkInterval = setInterval(async () => {
      await this.checkAlerts();
    }, intervalMinutes * 60 * 1000);

    // Run immediately
    this.checkAlerts();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[AlertManager] ⏸️ Monitoring stopped');
    }
  }

  /**
   * Check for arbitrage opportunities and send alerts
   */
  async checkAlerts(): Promise<void> {
    console.log('[AlertManager] 🔍 Checking alerts...');

    const enabledConfigs = Array.from(this.configs.values()).filter(c => c.enabled);

    if (enabledConfigs.length === 0) {
      console.log('[AlertManager] ⚠️ No enabled alert configs');
      return;
    }

    for (const config of enabledConfigs) {
      try {
        await this.checkConfigAlerts(config);
      } catch (error) {
        console.error(`[AlertManager] ❌ Error checking config ${config.id}:`, error);
      }
    }

    // Cleanup old state
    this.stateManager.cleanup(60);
  }

  /**
   * Check alerts for a specific config
   */
  private async checkConfigAlerts(config: AlertConfig): Promise<void> {
    const calculator = new ArbitrageCalculator(this.env.DB);

    // Get symbols to check
    const symbols = config.symbols && config.symbols.length > 0
      ? config.symbols
      : undefined; // All symbols

    try {
      // Calculate arbitrage for all symbols or specific ones
      if (symbols) {
        // Check each symbol
        for (const symbol of symbols) {
          const opportunities = await calculator.calculate(
            config.exchanges,
            symbol,
            config.minProfitPercent,
            false // Use snapshots for real-time data
          );

          for (const opp of opportunities) {
            await this.processOpportunity(config, opp);
          }
        }
      } else {
        // Check all symbols
        const opportunities = await calculator.calculate(
          config.exchanges,
          undefined,
          config.minProfitPercent,
          false
        );

        for (const opp of opportunities) {
          await this.processOpportunity(config, opp);
        }
      }

    } catch (error) {
      console.error(`[AlertManager] ❌ Error calculating arbitrage:`, error);
    }
  }

  /**
   * Process a single arbitrage opportunity
   */
  private async processOpportunity(
    config: AlertConfig,
    opportunity: any
  ): Promise<void> {

    // Check cooldown
    if (!this.stateManager.shouldAlert(
      opportunity.symbol,
      opportunity.buyFrom,
      opportunity.sellTo,
      config.cooldownMinutes
    )) {
      console.log(`[AlertManager] ⏱️ Cooldown active for ${opportunity.symbol} ${opportunity.buyFrom}→${opportunity.sellTo}`);
      return;
    }

    // Create alert event
    const event: AlertEvent = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      configId: config.id,
      timestamp: Date.now(),
      opportunity: {
        symbol: opportunity.symbol,
        buyFrom: opportunity.buyFrom,
        sellTo: opportunity.sellTo,
        buyPrice: opportunity.buyPrice,
        sellPrice: opportunity.sellPrice,
        profit: opportunity.profit,
        profitPercent: opportunity.profitPercent
      },
      status: 'pending',
      channels: []
    };

    console.log(`[AlertManager] 🚨 Alert triggered: ${opportunity.symbol} ${opportunity.profitPercent.toFixed(2)}% ${opportunity.buyFrom}→${opportunity.sellTo}`);

    // Send to all enabled channels
    for (const channel of config.channels.filter(c => c.enabled)) {
      try {
        await this.sendAlert(event, channel);
        event.channels.push({
          type: channel.type,
          status: 'sent'
        });
      } catch (error: any) {
        console.error(`[AlertManager] ❌ Failed to send to ${channel.type}:`, error);
        event.channels.push({
          type: channel.type,
          status: 'failed',
          error: error.message
        });
      }
    }

    // Update state
    event.status = event.channels.every(c => c.status === 'sent') ? 'sent' : 'failed';
    this.stateManager.markAlertSent(
      opportunity.symbol,
      opportunity.buyFrom,
      opportunity.sellTo
    );
    this.stateManager.addAlert(event);
  }

  /**
   * Send alert to a specific channel
   */
  private async sendAlert(event: AlertEvent, channel: any): Promise<void> {
    switch (channel.type) {
      case 'webhook':
        await this.sendWebhook(event, channel.config as WebhookConfig);
        break;

      case 'console':
        this.sendConsole(event, channel.config);
        break;

      case 'email':
        // TODO: Implement email via Cloudflare Email Routing or external service
        throw new Error('Email alerts not yet implemented');

      default:
        throw new Error(`Unknown channel type: ${channel.type}`);
    }
  }

  /**
   * Send webhook alert
   */
  private async sendWebhook(event: AlertEvent, config: WebhookConfig): Promise<void> {
    const template = config.template || 'default';
    const payload = AlertTemplates.getTemplate(template)(event);

    const response = await fetch(config.url, {
      method: config.method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ArbitrageAlertManager/1.0',
        ...(config.headers || {})
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }

    console.log(`[AlertManager] ✅ Webhook sent to ${config.url}`);
  }

  /**
   * Send console alert (for testing)
   */
  private sendConsole(event: AlertEvent, config: any): void {
    const { opportunity } = event;

    if (config.format === 'json') {
      console.log('[AlertManager] 🚨 ALERT:', JSON.stringify(opportunity, null, 2));
    } else {
      console.log(
        `[AlertManager] 🚨 ALERT: ${opportunity.symbol} ` +
        `${opportunity.profitPercent.toFixed(2)}% ` +
        `(Buy ${opportunity.buyFrom} @ ${opportunity.buyPrice.toFixed(2)}, ` +
        `Sell ${opportunity.sellTo} @ ${opportunity.sellPrice.toFixed(2)})`
      );
    }
  }

  /**
   * Handle HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // GET /configs - List all alert configs
      if (url.pathname === '/configs' && request.method === 'GET') {
        return new Response(JSON.stringify({
          configs: Array.from(this.configs.values()),
          count: this.configs.size
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /configs - Create/update alert config
      if (url.pathname === '/configs' && request.method === 'POST') {
        const config: AlertConfig = await request.json();
        config.updatedAt = Date.now();

        if (!config.id) {
          config.id = `alert-${Date.now()}`;
          config.createdAt = Date.now();
        }

        this.configs.set(config.id, config);

        return new Response(JSON.stringify({ success: true, config }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // DELETE /configs/:id - Delete config
      if (url.pathname.startsWith('/configs/') && request.method === 'DELETE') {
        const id = url.pathname.split('/')[2];
        const deleted = this.configs.delete(id);

        return new Response(JSON.stringify({ success: deleted }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // GET /alerts - Get recent alerts
      if (url.pathname === '/alerts' && request.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const alerts = this.stateManager.getRecentAlerts(limit);

        return new Response(JSON.stringify({
          alerts,
          count: alerts.length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /start - Start monitoring
      if (url.pathname === '/start' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const intervalMinutes = body.intervalMinutes || 1;

        this.startMonitoring(intervalMinutes);

        return new Response(JSON.stringify({
          success: true,
          message: `Monitoring started (interval: ${intervalMinutes} min)`
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /stop - Stop monitoring
      if (url.pathname === '/stop' && request.method === 'POST') {
        this.stopMonitoring();

        return new Response(JSON.stringify({
          success: true,
          message: 'Monitoring stopped'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /check - Manually trigger alert check
      if (url.pathname === '/check' && request.method === 'POST') {
        await this.checkAlerts();

        return new Response(JSON.stringify({
          success: true,
          message: 'Alert check triggered'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (error: any) {
      return new Response(JSON.stringify({
        error: error.message || 'Internal error'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
}
