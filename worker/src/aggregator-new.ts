/**
 * Streaming Orderbook Aggregator
 * Aggregiert Orderbook-Updates in 15s-Fenstern für Memory-Effizienz
 */

interface SymbolStats {
  bidSum: number;
  askSum: number;
  bidCount: number;
  askCount: number;
  spreadSum: number;
  spreadCount: number;
  minBid: number;
  maxBid: number;
  minAsk: number;
  maxAsk: number;
}

export class OrderbookAggregator {
  private currentWindow: Map<string, SymbolStats>;
  private windowStart: number;
  private windowDuration: number = 15000; // 15 Sekunden
  private db: D1Database;
  private flushTimer: any = null;

  constructor(db: D1Database) {
    this.db = db;
    this.currentWindow = new Map();
    this.windowStart = Date.now();

    console.log(`[Aggregator] 🎬 Started - Window: ${this.windowDuration}ms`);
    this.startFlushTimer();
  }

  /**
   * Verarbeitet ein Orderbook-Update (nur beste Bid/Ask)
   */
  process(symbol: string, bid: number | null, ask: number | null): void {
    if (!this.currentWindow.has(symbol)) {
      this.currentWindow.set(symbol, {
        bidSum: 0,
        askSum: 0,
        bidCount: 0,
        askCount: 0,
        spreadSum: 0,
        spreadCount: 0,
        minBid: Infinity,
        maxBid: -Infinity,
        minAsk: Infinity,
        maxAsk: -Infinity,
      });
    }

    const stats = this.currentWindow.get(symbol)!;

    if (bid !== null && bid > 0) {
      stats.bidSum += bid;
      stats.bidCount++;
      stats.minBid = Math.min(stats.minBid, bid);
      stats.maxBid = Math.max(stats.maxBid, bid);
    }

    if (ask !== null && ask > 0) {
      stats.askSum += ask;
      stats.askCount++;
      stats.minAsk = Math.min(stats.minAsk, ask);
      stats.maxAsk = Math.max(stats.maxAsk, ask);
    }

    if (bid !== null && ask !== null && bid > 0 && ask > 0) {
      stats.spreadSum += (ask - bid);
      stats.spreadCount++;
    }
  }

  /**
   * Auto-Flush Timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      const elapsed = Date.now() - this.windowStart;
      if (elapsed >= this.windowDuration) {
        await this.flush();
      }
    }, 5000); // Check alle 5s
  }

  /**
   * Stoppt Timer
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      console.log(`[Aggregator] ⏹️ Stopped`);
    }
  }

  /**
   * Schreibt aktuelles Fenster in DB
   */
  async flush(): Promise<void> {
    const symbolCount = this.currentWindow.size;
    if (symbolCount === 0) {
      this.windowStart = Date.now();
      return;
    }

    // Timestamp auf 15s-Grenze runden
    const timestamp = Math.floor(this.windowStart / this.windowDuration) * this.windowDuration;
    const windowDate = new Date(timestamp).toISOString();

    console.log(`[Aggregator] 💾 Flushing ${symbolCount} symbols for window ${windowDate}`);

    try {
      const statements: D1PreparedStatement[] = [];

      for (const [symbol, stats] of this.currentWindow) {
        const totalTicks = Math.max(stats.bidCount, stats.askCount);

        statements.push(
          this.db.prepare(
            `INSERT INTO lighter_snapshots
             (symbol, timestamp, avg_bid, avg_ask, avg_spread, min_bid, max_bid, min_ask, max_ask, tick_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            symbol,
            timestamp,
            stats.bidCount > 0 ? stats.bidSum / stats.bidCount : null,
            stats.askCount > 0 ? stats.askSum / stats.askCount : null,
            stats.spreadCount > 0 ? stats.spreadSum / stats.spreadCount : null,
            stats.minBid !== Infinity ? stats.minBid : null,
            stats.maxBid !== -Infinity ? stats.maxBid : null,
            stats.minAsk !== Infinity ? stats.minAsk : null,
            stats.maxAsk !== -Infinity ? stats.maxAsk : null,
            totalTicks
          )
        );
      }

      // Batch-Insert (max 50 pro Batch)
      const batches = this.chunkArray(statements, 50);
      for (const batch of batches) {
        await this.db.batch(batch);
      }

      console.log(`[Aggregator] ✅ Flushed ${symbolCount} snapshots`);

      // Prüfe ob Minuten-Aggregation nötig
      await this.maybeAggregateMinute(timestamp);

    } catch (error) {
      console.error(`[Aggregator] ❌ Flush error:`, error);
    }

    // Memory freigeben!
    this.currentWindow.clear();
    this.windowStart = Date.now();
  }

  /**
   * Aggregiert zu Minuten-Durchschnitt wenn 4 Snapshots vorhanden
   */
  private async maybeAggregateMinute(currentTimestamp: number): Promise<void> {
    const minuteStart = Math.floor(currentTimestamp / 60000) * 60000;
    const windowPosition = Math.floor((currentTimestamp - minuteStart) / this.windowDuration);

    // Bei 4. Snapshot (45s)
    if (windowPosition === 3) {
      console.log(`[Aggregator] 📊 Calculating minute average for ${new Date(minuteStart).toISOString()}`);

      try {
        const result = await this.db.prepare(`
          SELECT symbol,
                 AVG(avg_bid) as minute_avg_bid,
                 AVG(avg_ask) as minute_avg_ask,
                 AVG(avg_spread) as minute_avg_spread,
                 MIN(min_bid) as minute_min_bid,
                 MAX(max_bid) as minute_max_bid,
                 MIN(min_ask) as minute_min_ask,
                 MAX(max_ask) as minute_max_ask,
                 SUM(tick_count) as total_ticks
          FROM lighter_snapshots
          WHERE timestamp >= ? AND timestamp < ?
          GROUP BY symbol
        `).bind(minuteStart, minuteStart + 60000).all();

        if (result.results && result.results.length > 0) {
          const statements = result.results.map((row: any) =>
            this.db.prepare(
              `INSERT OR REPLACE INTO lighter_minutes
               (symbol, timestamp, avg_bid, avg_ask, avg_spread, min_bid, max_bid, min_ask, max_ask, tick_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              row.symbol,
              minuteStart,
              row.minute_avg_bid,
              row.minute_avg_ask,
              row.minute_avg_spread,
              row.minute_min_bid,
              row.minute_max_bid,
              row.minute_min_ask,
              row.minute_max_ask,
              row.total_ticks
            )
          );

          await this.db.batch(statements);
          console.log(`[Aggregator] ✅ Aggregated ${result.results.length} minute averages`);
        }

        // Alte Snapshots löschen
        await this.db.prepare(
          `DELETE FROM lighter_snapshots WHERE timestamp < ?`
        ).bind(minuteStart).run();

        console.log(`[Aggregator] 🧹 Cleaned old snapshots`);

      } catch (error) {
        console.error(`[Aggregator] ❌ Minute aggregation error:`, error);
      }
    }
  }

  /**
   * Cleanup alte Minuten-Daten (>1h)
   */
  async cleanupOldMinutes(): Promise<void> {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    try {
      const result = await this.db.prepare(
        `DELETE FROM lighter_minutes WHERE timestamp < ?`
      ).bind(oneHourAgo).run();

      if (result.meta.changes && result.meta.changes > 0) {
        console.log(`[Aggregator] 🧹 Deleted ${result.meta.changes} old minute records`);
      }
    } catch (error) {
      console.error(`[Aggregator] ❌ Cleanup error:`, error);
    }
  }

  /**
   * Helper: Array chunking
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Stats für Frontend
   */
  getStats() {
    return {
      currentSymbols: this.currentWindow.size,
      windowStart: this.windowStart,
      windowElapsed: Date.now() - this.windowStart,
      windowDuration: this.windowDuration,
    };
  }
}
