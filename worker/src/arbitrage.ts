/**
 * Arbitrage Calculator - Cross-Exchange Opportunity Detection
 *
 * Architecture:
 * - Modular design for easy addition of new exchanges
 * - Real-time calculation from latest snapshots
 * - Supports threshold-based filtering
 *
 * Usage:
 *   const calculator = new ArbitrageCalculator(db);
 *   const opportunities = await calculator.calculate(['lighter', 'paradex'], 'BTC');
 */

export interface ExchangePrice {
  exchange: string;
  symbol: string;
  timestamp: number;
  bid: number;
  ask: number;
  spread: number;
  source?: 'snapshots' | 'minutes';
}

export interface ArbitrageOpportunity {
  symbol: string;
  buyFrom: string;
  sellTo: string;
  buyPrice: number;  // Ask on buy exchange
  sellPrice: number; // Bid on sell exchange
  profit: number;    // Absolute profit
  profitPercent: number; // Percentage profit
  timestamp: number;
  dataAge: number;   // Age of data in ms
}

export class ArbitrageCalculator {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Calculate arbitrage opportunities across exchanges
   *
   * @param exchanges - List of exchange names (e.g., ['lighter', 'paradex'])
   * @param symbol - Optional: Filter by symbol (e.g., 'BTC', 'ETH')
   * @param minProfitPercent - Optional: Minimum profit percentage to return
   * @param useMinutes - Use minute aggregations instead of snapshots (default: false)
   */
  async calculate(
    exchanges: string[],
    symbol?: string,
    minProfitPercent: number = 0,
    useMinutes: boolean = false
  ): Promise<ArbitrageOpportunity[]> {

    if (exchanges.length < 2) {
      throw new Error('Need at least 2 exchanges for arbitrage calculation');
    }

    // Fetch latest prices from all exchanges
    const pricesByExchange = await Promise.all(
      exchanges.map(ex => this.getLatestPrices(ex, symbol, useMinutes))
    );

    // Flatten and group by symbol
    const pricesBySymbol = new Map<string, ExchangePrice[]>();

    for (const prices of pricesByExchange) {
      for (const price of prices) {
        if (!pricesBySymbol.has(price.symbol)) {
          pricesBySymbol.set(price.symbol, []);
        }
        pricesBySymbol.get(price.symbol)!.push(price);
      }
    }

    // Calculate arbitrage opportunities
    const opportunities: ArbitrageOpportunity[] = [];
    const now = Date.now();

    for (const [sym, prices] of pricesBySymbol) {
      // Need at least 2 exchanges for this symbol
      if (prices.length < 2) continue;

      // Compare all pairs
      for (let i = 0; i < prices.length; i++) {
        for (let j = i + 1; j < prices.length; j++) {
          const price1 = prices[i];
          const price2 = prices[j];

          // Calculate both directions

          // Direction 1: Buy from exchange1, sell to exchange2
          // Buy at ask on exchange1, sell at bid on exchange2
          const profit1 = price2.bid - price1.ask;
          const profitPercent1 = (profit1 / price1.ask) * 100;

          if (profitPercent1 >= minProfitPercent) {
            opportunities.push({
              symbol: sym,
              buyFrom: price1.exchange,
              sellTo: price2.exchange,
              buyPrice: price1.ask,
              sellPrice: price2.bid,
              profit: profit1,
              profitPercent: profitPercent1,
              timestamp: Math.max(price1.timestamp, price2.timestamp),
              dataAge: now - Math.max(price1.timestamp, price2.timestamp)
            });
          }

          // Direction 2: Buy from exchange2, sell to exchange1
          const profit2 = price1.bid - price2.ask;
          const profitPercent2 = (profit2 / price2.ask) * 100;

          if (profitPercent2 >= minProfitPercent) {
            opportunities.push({
              symbol: sym,
              buyFrom: price2.exchange,
              sellTo: price1.exchange,
              buyPrice: price2.ask,
              sellPrice: price1.bid,
              profit: profit2,
              profitPercent: profitPercent2,
              timestamp: Math.max(price1.timestamp, price2.timestamp),
              dataAge: now - Math.max(price1.timestamp, price2.timestamp)
            });
          }
        }
      }
    }

    // Sort by profit percentage (descending)
    opportunities.sort((a, b) => b.profitPercent - a.profitPercent);

    return opportunities;
  }

  /**
   * Get latest prices from a specific exchange
   */
  private async getLatestPrices(
    exchange: string,
    symbol?: string,
    useMinutes: boolean = false
  ): Promise<ExchangePrice[]> {

    const table = useMinutes
      ? `${exchange}_minutes`
      : `${exchange}_snapshots`;

    try {
      // Get latest snapshot per symbol
      let query = `
        SELECT
          symbol,
          timestamp,
          avg_bid as bid,
          avg_ask as ask,
          avg_spread as spread
        FROM ${table}
        WHERE timestamp IN (
          SELECT MAX(timestamp)
          FROM ${table}
          ${symbol ? 'WHERE symbol = ?' : ''}
          GROUP BY symbol
        )
      `;

      const bindings = symbol ? [symbol] : [];
      const result = await this.db.prepare(query).bind(...bindings).all();

      return (result.results || []).map((row: any) => ({
        exchange,
        symbol: row.symbol,
        timestamp: row.timestamp,
        bid: row.bid,
        ask: row.ask,
        spread: row.spread,
        source: useMinutes ? 'minutes' : 'snapshots'
      }));

    } catch (error) {
      console.error(`[Arbitrage] Failed to fetch prices from ${exchange}:`, error);
      return [];
    }
  }

  /**
   * Get historical arbitrage data for a symbol across time range
   */
  async getHistoricalArbitrage(
    exchanges: string[],
    symbol: string,
    from: number,
    to: number,
    interval: 'snapshots' | 'minutes' = 'minutes'
  ): Promise<ArbitrageOpportunity[]> {

    if (exchanges.length < 2) {
      throw new Error('Need at least 2 exchanges for arbitrage calculation');
    }

    // Fetch time-series data from all exchanges
    const table = interval === 'minutes' ? '_minutes' : '_snapshots';

    const pricesByExchange = await Promise.all(
      exchanges.map(async (exchange) => {
        const query = `
          SELECT
            timestamp,
            symbol,
            avg_bid as bid,
            avg_ask as ask,
            avg_spread as spread
          FROM ${exchange}${table}
          WHERE symbol = ?
            AND timestamp >= ?
            AND timestamp <= ?
          ORDER BY timestamp ASC
        `;

        const result = await this.db.prepare(query).bind(symbol, from, to).all();

        return (result.results || []).map((row: any) => ({
          exchange,
          symbol: row.symbol,
          timestamp: row.timestamp,
          bid: row.bid,
          ask: row.ask,
          spread: row.spread,
          source: interval
        }));
      })
    );

    // Group by timestamp
    const pricesByTimestamp = new Map<number, ExchangePrice[]>();

    for (const prices of pricesByExchange) {
      for (const price of prices) {
        if (!pricesByTimestamp.has(price.timestamp)) {
          pricesByTimestamp.set(price.timestamp, []);
        }
        pricesByTimestamp.get(price.timestamp)!.push(price);
      }
    }

    // Calculate arbitrage for each timestamp
    const opportunities: ArbitrageOpportunity[] = [];

    for (const [timestamp, prices] of pricesByTimestamp) {
      if (prices.length < 2) continue;

      // Compare all pairs at this timestamp
      for (let i = 0; i < prices.length; i++) {
        for (let j = i + 1; j < prices.length; j++) {
          const price1 = prices[i];
          const price2 = prices[j];

          // Direction 1
          const profit1 = price2.bid - price1.ask;
          const profitPercent1 = (profit1 / price1.ask) * 100;

          opportunities.push({
            symbol,
            buyFrom: price1.exchange,
            sellTo: price2.exchange,
            buyPrice: price1.ask,
            sellPrice: price2.bid,
            profit: profit1,
            profitPercent: profitPercent1,
            timestamp,
            dataAge: 0 // Historical data
          });

          // Direction 2
          const profit2 = price1.bid - price2.ask;
          const profitPercent2 = (profit2 / price2.ask) * 100;

          opportunities.push({
            symbol,
            buyFrom: price2.exchange,
            sellTo: price1.exchange,
            buyPrice: price2.ask,
            sellPrice: price1.bid,
            profit: profit2,
            profitPercent: profitPercent2,
            timestamp,
            dataAge: 0
          });
        }
      }
    }

    return opportunities;
  }
}
