/**
 * OrderBook Aggregator - Streaming Aggregation für Memory-Effizienz
 * Aggregiert Orderbook-Updates in 15s-Fenstern
 */

interface SymbolAggregator {
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

interface Snapshot {
  source: string;
  symbol: string;
  timestamp: number;
  avg_bid: number | null;
  avg_ask: number | null;
  avg_spread: number | null;
  min_bid: number | null;
  max_bid: number | null;
  min_ask: number | null;
  max_ask: number | null;
  tick_count: number;
}

export class OrderBookAggregator {
  private currentWindow: Map<string, SymbolAggregator>;
  private windowStart: number;
  private windowDuration: number = 15000; // 15 seconds
  private db: D1Database;
  private source: string;
  private flushTimer: any = null;

  constructor(db: D1Database, source: string) {
    this.db = db;
    this.source = source;
    this.currentWindow = new Map();
    this.windowStart = Date.now();

    // Auto-flush nach 15s
    this.startFlushTimer();
  }

  /**
   * Verarbeitet ein Orderbook-Update
   */
  processUpdate(symbol: string, bid: number | null, ask: number | null) {
    // Aggregator für Symbol holen/erstellen
    if (!this.currentWindow.has(symbol)) {
      this.currentWindow.set(symbol, {
        bidSum: 0,
        askSum: 0,
        bidCount: 0,
        askCount: 0,
        spreadSum: 0,
        spreadCount: 0,
        minBid: bid ?? Infinity,
        maxBid: bid ?? -Infinity,
        minAsk: ask ?? Infinity,
        maxAsk: ask ?? -Infinity,
      });
    }

    const agg = this.currentWindow.get(symbol)!;

    // Bid aggregieren
    if (bid !== null) {
      agg.bidSum += bid;
      agg.bidCount++;
      agg.minBid = Math.min(agg.minBid, bid);
      agg.maxBid = Math.max(agg.maxBid, bid);
    }

    // Ask aggregieren
    if (ask !== null) {
      agg.askSum += ask;
      agg.askCount++;
      agg.minAsk = Math.min(agg.minAsk, ask);
      agg.maxAsk = Math.max(agg.maxAsk, ask);
    }

    // Spread aggregieren
    if (bid !== null && ask !== null) {
      agg.spreadSum += (ask - bid);
      agg.spreadCount++;
    }
  }

  /**
   * Startet Timer für automatisches Flushing
   */
  private startFlushTimer() {
    this.flushTimer = setInterval(async () => {
      const elapsed = Date.now() - this.windowStart;
      if (elapsed >= this.windowDuration) {
        await this.flushWindow();
      }
    }, 5000); // Prüfe alle 5s
  }

  /**
   * Stoppt den Flush-Timer
   */
  stopFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Schreibt aktuelles Fenster in die Datenbank
   */
  async flushWindow(): Promise<void> {
    if (this.currentWindow.size === 0) {
      console.log(`[${this.source}] No data to flush`);
      this.windowStart = Date.now();
      return;
    }

    // Timestamp auf 15s-Grenze runden
    const timestamp = Math.floor(this.windowStart / this.windowDuration) * this.windowDuration;

    console.log(`[${this.source}] 💾 Flushing ${this.currentWindow.size} symbols for window ${new Date(timestamp).toISOString()}`);

    const snapshots: Snapshot[] = [];

    for (const [symbol, agg] of this.currentWindow) {
      const totalTicks = Math.max(agg.bidCount, agg.askCount);

      snapshots.push({
        source: this.source,
        symbol,
        timestamp,
        avg_bid: agg.bidCount > 0 ? agg.bidSum / agg.bidCount : null,
        avg_ask: agg.askCount > 0 ? agg.askSum / agg.askCount : null,
        avg_spread: agg.spreadCount > 0 ? agg.spreadSum / agg.spreadCount : null,
        min_bid: agg.minBid !== Infinity ? agg.minBid : null,
        max_bid: agg.maxBid !== -Infinity ? agg.maxBid : null,
        min_ask: agg.minAsk !== Infinity ? agg.minAsk : null,
        max_ask: agg.maxAsk !== -Infinity ? agg.maxAsk : null,
        tick_count: totalTicks,
      });
    }

    // Batch-Insert in D1
    try {
      const batches = this.chunkArray(snapshots, 50); // Max 50 pro Batch

      for (const batch of batches) {
        const statements = batch.map((s) =>
          this.db.prepare(
            `INSERT INTO orderbook_snapshots
             (source, symbol, timestamp, avg_bid, avg_ask, avg_spread, min_bid, max_bid, min_ask, max_ask, tick_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            s.source,
            s.symbol,
            s.timestamp,
            s.avg_bid,
            s.avg_ask,
            s.avg_spread,
            s.min_bid,
            s.max_bid,
            s.min_ask,
            s.max_ask,
            s.tick_count
          )
        );

        await this.db.batch(statements);
      }

      console.log(`[${this.source}] ✅ Flushed ${snapshots.length} snapshots`);

      // Prüfe ob Minuten-Aggregation nötig ist
      await this.maybeCalculateMinuteAverage(timestamp);

    } catch (error) {
      console.error(`[${this.source}] ❌ Error flushing snapshots:`, error);
    }

    // WICHTIG: Memory sofort freigeben!
    this.currentWindow.clear();
    this.windowStart = Date.now();
  }

  /**
   * Berechnet Minuten-Durchschnitt wenn 4 Snapshots vorhanden
   */
  private async maybeCalculateMinuteAverage(currentTimestamp: number): Promise<void> {
    const minuteStart = Math.floor(currentTimestamp / 60000) * 60000;
    const windowPosition = Math.floor((currentTimestamp - minuteStart) / this.windowDuration);

    // Bei 4. Snapshot (45s) den Minuten-Durchschnitt berechnen
    if (windowPosition === 3) {
      console.log(`[${this.source}] 📊 Calculating minute average for ${new Date(minuteStart).toISOString()}`);

      try {
        const result = await this.db.prepare(`
          SELECT source,
                 symbol,
                 AVG(avg_bid) as minute_avg_bid,
                 AVG(avg_ask) as minute_avg_ask,
                 AVG(avg_spread) as minute_avg_spread,
                 MIN(min_bid) as minute_min_bid,
                 MAX(max_bid) as minute_max_bid,
                 MIN(min_ask) as minute_min_ask,
                 MAX(max_ask) as minute_max_ask,
                 SUM(tick_count) as total_ticks
          FROM orderbook_snapshots
          WHERE timestamp >= ? AND timestamp < ? AND source = ?
          GROUP BY source, symbol
        `).bind(minuteStart, minuteStart + 60000, this.source).all();

        if (result.results && result.results.length > 0) {
          // Minute-Aggregation in separate Tabelle schreiben
          const statements = result.results.map((row: any) =>
            this.db.prepare(
              `INSERT OR REPLACE INTO orderbook_minutes
               (source, symbol, timestamp, avg_bid, avg_ask, avg_spread, min_bid, max_bid, min_ask, max_ask, tick_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              row.source,
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
          console.log(`[${this.source}] ✅ Calculated ${result.results.length} minute averages`);
        }

        // Alte 15s-Snapshots löschen (behalte nur letzte Minute)
        await this.db.prepare(
          `DELETE FROM orderbook_snapshots WHERE timestamp < ? AND source = ?`
        ).bind(minuteStart, this.source).run();

        console.log(`[${this.source}] 🧹 Cleaned up old snapshots`);

      } catch (error) {
        console.error(`[${this.source}] ❌ Error calculating minute average:`, error);
      }
    }
  }

  /**
   * Cleanup: Alte Minuten-Daten löschen (älter als 1 Stunde)
   */
  async cleanupOldData(): Promise<void> {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    try {
      const result = await this.db.prepare(
        `DELETE FROM orderbook_minutes WHERE timestamp < ? AND source = ?`
      ).bind(oneHourAgo, this.source).run();

      if (result.meta.changes && result.meta.changes > 0) {
        console.log(`[${this.source}] 🧹 Deleted ${result.meta.changes} old minute records`);
      }
    } catch (error) {
      console.error(`[${this.source}] ❌ Error cleaning up old data:`, error);
    }
  }

  /**
   * Helper: Array in Chunks aufteilen
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Erzwingt sofortiges Flushing (z.B. beim Stoppen)
   */
  async forceFlush(): Promise<void> {
    await this.flushWindow();
  }
}
