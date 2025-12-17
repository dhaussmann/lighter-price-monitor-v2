/**
 * Alert System - Configuration & Types
 *
 * Supports multiple alert channels and configurable thresholds
 */

export interface AlertConfig {
  id: string;
  name: string;
  enabled: boolean;

  // Arbitrage filters
  minProfitPercent: number;
  symbols?: string[];  // Empty = all symbols
  exchanges: string[]; // Exchanges to monitor

  // Alert settings
  channels: AlertChannel[];
  cooldownMinutes: number; // Minimum time between same alert

  createdAt: number;
  updatedAt: number;
}

export interface AlertChannel {
  type: 'webhook' | 'email' | 'console';
  config: WebhookConfig | EmailConfig | ConsoleConfig;
  enabled: boolean;
}

export interface WebhookConfig {
  url: string;
  method: 'POST' | 'GET';
  headers?: Record<string, string>;
  template?: 'default' | 'slack' | 'discord' | 'custom';
  customPayload?: string; // JSON template with placeholders
}

export interface EmailConfig {
  to: string[];
  from?: string;
  subject?: string;
}

export interface ConsoleConfig {
  format: 'json' | 'text';
}

export interface AlertEvent {
  id: string;
  configId: string;
  timestamp: number;

  opportunity: {
    symbol: string;
    buyFrom: string;
    sellTo: string;
    buyPrice: number;
    sellPrice: number;
    profit: number;
    profitPercent: number;
  };

  status: 'pending' | 'sent' | 'failed';
  channels: {
    type: string;
    status: 'sent' | 'failed';
    error?: string;
  }[];
}

/**
 * Default alert configurations
 */
export const DEFAULT_ALERT_CONFIGS: AlertConfig[] = [
  {
    id: 'default-arbitrage',
    name: 'Default Arbitrage Alert',
    enabled: false, // User must enable manually
    minProfitPercent: 0.5,
    symbols: [], // All symbols
    exchanges: ['lighter', 'paradex', 'hyperliquid'],
    channels: [
      {
        type: 'console',
        config: { format: 'json' },
        enabled: true
      }
    ],
    cooldownMinutes: 5,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

/**
 * Alert Templates
 */
export class AlertTemplates {
  /**
   * Format alert for Slack webhook
   */
  static slack(event: AlertEvent): any {
    const { opportunity } = event;
    const profit = opportunity.profit.toFixed(2);
    const profitPercent = opportunity.profitPercent.toFixed(2);

    return {
      text: `🚨 Arbitrage Opportunity Detected!`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Arbitrage Opportunity'
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Symbol:*\n${opportunity.symbol}`
            },
            {
              type: 'mrkdwn',
              text: `*Profit:*\n${profitPercent}% ($${profit})`
            },
            {
              type: 'mrkdwn',
              text: `*Buy From:*\n${opportunity.buyFrom} @ $${opportunity.buyPrice.toFixed(2)}`
            },
            {
              type: 'mrkdwn',
              text: `*Sell To:*\n${opportunity.sellTo} @ $${opportunity.sellPrice.toFixed(2)}`
            }
          ]
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Detected at ${new Date(event.timestamp).toISOString()}`
            }
          ]
        }
      ]
    };
  }

  /**
   * Format alert for Discord webhook
   */
  static discord(event: AlertEvent): any {
    const { opportunity } = event;
    const profit = opportunity.profit.toFixed(2);
    const profitPercent = opportunity.profitPercent.toFixed(2);

    return {
      content: '🚨 **Arbitrage Opportunity Detected!**',
      embeds: [
        {
          title: `${opportunity.symbol} Arbitrage`,
          color: 0x00ff00, // Green
          fields: [
            {
              name: 'Profit',
              value: `${profitPercent}% ($${profit})`,
              inline: true
            },
            {
              name: 'Direction',
              value: `${opportunity.buyFrom} → ${opportunity.sellTo}`,
              inline: true
            },
            {
              name: 'Buy Price',
              value: `$${opportunity.buyPrice.toFixed(2)}`,
              inline: true
            },
            {
              name: 'Sell Price',
              value: `$${opportunity.sellPrice.toFixed(2)}`,
              inline: true
            }
          ],
          timestamp: new Date(event.timestamp).toISOString()
        }
      ]
    };
  }

  /**
   * Default JSON payload
   */
  static default(event: AlertEvent): any {
    return {
      alert_type: 'arbitrage_opportunity',
      timestamp: event.timestamp,
      opportunity: event.opportunity
    };
  }

  /**
   * Get template by name
   */
  static getTemplate(template: string): (event: AlertEvent) => any {
    switch (template) {
      case 'slack':
        return this.slack;
      case 'discord':
        return this.discord;
      default:
        return this.default;
    }
  }
}

/**
 * Alert State - Track sent alerts to prevent spam
 */
export interface AlertState {
  lastAlertTime: Map<string, number>; // key = "symbol-buyFrom-sellTo"
  recentAlerts: AlertEvent[];
}

export class AlertStateManager {
  private state: AlertState;

  constructor() {
    this.state = {
      lastAlertTime: new Map(),
      recentAlerts: []
    };
  }

  /**
   * Check if alert should be sent (respects cooldown)
   */
  shouldAlert(
    symbol: string,
    buyFrom: string,
    sellTo: string,
    cooldownMinutes: number
  ): boolean {
    const key = `${symbol}-${buyFrom}-${sellTo}`;
    const lastTime = this.state.lastAlertTime.get(key);

    if (!lastTime) return true;

    const cooldownMs = cooldownMinutes * 60 * 1000;
    const timeSinceLastAlert = Date.now() - lastTime;

    return timeSinceLastAlert >= cooldownMs;
  }

  /**
   * Mark alert as sent
   */
  markAlertSent(symbol: string, buyFrom: string, sellTo: string): void {
    const key = `${symbol}-${buyFrom}-${sellTo}`;
    this.state.lastAlertTime.set(key, Date.now());
  }

  /**
   * Add to recent alerts history
   */
  addAlert(event: AlertEvent): void {
    this.state.recentAlerts.push(event);

    // Keep only last 100 alerts
    if (this.state.recentAlerts.length > 100) {
      this.state.recentAlerts = this.state.recentAlerts.slice(-100);
    }
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 20): AlertEvent[] {
    return this.state.recentAlerts.slice(-limit).reverse();
  }

  /**
   * Clear old state (cleanup)
   */
  cleanup(maxAgeMinutes: number = 60): void {
    const cutoff = Date.now() - (maxAgeMinutes * 60 * 1000);

    // Remove old lastAlertTime entries
    for (const [key, time] of this.state.lastAlertTime.entries()) {
      if (time < cutoff) {
        this.state.lastAlertTime.delete(key);
      }
    }

    // Remove old alerts from history
    this.state.recentAlerts = this.state.recentAlerts.filter(
      alert => alert.timestamp >= cutoff
    );
  }
}
