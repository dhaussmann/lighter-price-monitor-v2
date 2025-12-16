# System Architecture

Multi-Exchange Orderbook Tracking with Real-time Arbitrage Detection

---

## Table of Contents

- [Overview](#overview)
- [System Components](#system-components)
- [Data Flow](#data-flow)
- [Storage Architecture](#storage-architecture)
- [Arbitrage Detection](#arbitrage-detection)
- [Alert System](#alert-system)
- [Scalability](#scalability)
- [Technology Stack](#technology-stack)

---

## Overview

### Goals

1. **Real-time Orderbook Tracking** across multiple DEX/CEX exchanges
2. **Memory-Efficient Aggregation** using streaming windows
3. **Cross-Exchange Arbitrage Detection** with configurable thresholds
4. **Alert System** for automated opportunity notifications
5. **Extensible Design** for easy addition of new exchanges

### Architecture Pattern

**Hybrid Approach:**
- **Tracking Workers** (Durable Objects) → Real-time data collection
- **Aggregation Layer** → Streaming window-based aggregation
- **Storage** (D1 SQLite) → Time-series data persistence
- **Arbitrage Calculator** → On-demand or scheduled calculation
- **Alert Manager** (Separate DO) → Independent monitoring and notifications

---

## System Components

```
┌──────────────────────────────────────────────────────────────────┐
│                        Cloudflare Workers                         │
└──────────────────────────────────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ LighterTracker│    │ParadexTracker │    │ AlertManager  │
│  (Durable     │    │  (Durable     │    │  (Durable     │
│   Object)     │    │   Object)     │    │   Object)     │
└───────────────┘    └───────────────┘    └───────────────┘
        │                      │                      │
        │   WebSocket          │   WebSocket          │
        ▼                      ▼                      │
┌───────────────┐    ┌───────────────┐              │
│    Lighter    │    │    Paradex    │              │
│   Exchange    │    │   Exchange    │              │
│   WebSocket   │    │   WebSocket   │              │
└───────────────┘    └───────────────┘              │
        │                      │                      │
        │   Orderbook          │   Orderbook          │
        │   Updates            │   Updates            │
        ▼                      ▼                      │
┌───────────────────────────────────────┐            │
│      OrderbookAggregator              │            │
│   (15s Window Streaming Processor)    │            │
└───────────────────────────────────────┘            │
                    │                                 │
                    │   Aggregated Data               │
                    ▼                                 │
┌───────────────────────────────────────┐            │
│         D1 Database (SQLite)          │            │
│                                       │            │
│  ┌─────────────────────────────────┐ │            │
│  │ lighter_markets                 │ │            │
│  │ lighter_snapshots (15s)         │ │            │
│  │ lighter_minutes (1min)          │ │            │
│  ├─────────────────────────────────┤ │            │
│  │ paradex_markets                 │ │            │
│  │ paradex_snapshots (15s)         │ │            │
│  │ paradex_minutes (1min)          │ │            │
│  └─────────────────────────────────┘ │            │
└───────────────────────────────────────┘            │
                    │                                 │
                    │   Query Data                    │
                    ▼                                 ▼
┌───────────────────────────────────────────────────────┐
│            ArbitrageCalculator                        │
│      (Dynamic Cross-Exchange Comparison)              │
└───────────────────────────────────────────────────────┘
                    │
                    │   Opportunities
                    ▼
┌───────────────────────────────────────────────────────┐
│                  Alert System                         │
│  (Webhook/Console/Email Notifications)                │
└───────────────────────────────────────────────────────┘
```

---

## System Components Details

### 1. Exchange Trackers (Durable Objects)

**Purpose**: Maintain persistent WebSocket connections to exchanges and collect orderbook data.

**Files:**
- `worker/src/lighter-new.ts` - LighterTracker
- `worker/src/paradex-new.ts` - ParadexTracker

**Responsibilities:**
- Load market symbols from exchange APIs
- Establish WebSocket connections
- Subscribe to orderbook updates
- Normalize data format
- Feed data to OrderbookAggregator
- Handle reconnection logic

**Key Features:**
- One Durable Object per exchange
- State persistence across requests
- Automatic reconnection on failure
- Memory efficient (constant ~75 KB)

### 2. OrderbookAggregator

**Purpose**: Stream-process orderbook updates into time-windowed aggregations.

**File:** `worker/src/aggregator-new.ts`

**Algorithm:**
```
For each 15-second window:
  1. Accumulate updates in memory
  2. Calculate: avg, min, max, count
  3. At window end → flush to {exchange}_snapshots
  4. After 4 windows (1 minute) → aggregate to {exchange}_minutes
  5. Clear memory
```

**Memory Usage:**
- **Per Symbol**: ~200 bytes (6 floats + counters)
- **20 Symbols**: ~4 KB total
- **Previous Approach**: 5-10 MB (stored every update)

**Performance:**
- **100x reduction** in database writes
- **Constant memory** footprint
- **Sub-second** latency for aggregation

### 3. D1 Database (SQLite)

**Purpose**: Time-series storage for aggregated orderbook data.

**Schema:**
```sql
-- Per Exchange (lighter, paradex, ...)
CREATE TABLE {exchange}_markets (
  symbol TEXT PRIMARY KEY,
  -- Exchange-specific metadata
);

CREATE TABLE {exchange}_snapshots (
  symbol TEXT,
  timestamp INTEGER,
  avg_bid REAL,
  avg_ask REAL,
  avg_spread REAL,
  min_bid REAL,
  max_bid REAL,
  min_ask REAL,
  max_ask REAL,
  tick_count INTEGER,
  -- 15-second aggregations
);

CREATE TABLE {exchange}_minutes (
  symbol TEXT,
  timestamp INTEGER,
  avg_bid REAL,
  avg_ask REAL,
  avg_spread REAL,
  -- ... same fields ...
  tick_count INTEGER,
  -- 1-minute aggregations (1h retention)
  UNIQUE(symbol, timestamp)
);
```

**Retention:**
- **Snapshots**: Temporary (used for minute calculation, then deleted)
- **Minutes**: 1 hour (configurable)
- **Markets**: Persistent

### 4. ArbitrageCalculator

**Purpose**: Calculate cross-exchange arbitrage opportunities on-demand.

**File:** `worker/src/arbitrage.ts`

**Method:**
```typescript
async calculate(
  exchanges: string[],
  symbol?: string,
  minProfitPercent: number = 0,
  useMinutes: boolean = false
): Promise<ArbitrageOpportunity[]>
```

**Algorithm:**
1. Fetch latest prices from each exchange
2. For each pair of exchanges (i, j):
   - Calculate profit: exchange_j.bid - exchange_i.ask
   - Calculate profit %
   - If >= minProfit → add to results
3. Sort by profitPercent (descending)

**Extensibility:**
```typescript
// Adding a new exchange:
const opportunities = await calculator.calculate(
  ['lighter', 'paradex', 'binance'],  // Just add to array!
  'BTC',
  0.5
);
```

### 5. AlertManager (Durable Object)

**Purpose**: Independent monitoring and alert dispatch.

**File:** `worker/src/alert-manager.ts`

**Architecture Benefits:**
- **Separation of Concerns**: Doesn't affect tracking performance
- **Flexible Scheduling**: Cron trigger or internal intervals
- **Stateful**: Maintains alert history and cooldown state
- **Multi-Channel**: Webhook, Console, Email (future)

**Alert Flow:**
```
Cron Trigger (every minute)
       ↓
AlertManager.checkAlerts()
       ↓
ArbitrageCalculator.calculate()
       ↓
Filter by config (minProfit, symbols, exchanges)
       ↓
Check cooldown (prevent spam)
       ↓
Send to channels (Webhook/Console)
       ↓
Update state (mark sent, add to history)
```

---

## Data Flow

### Real-time Tracking Flow

```
1. WebSocket Connection
   └─> Exchange sends orderbook update

2. Tracker DO receives update
   └─> Extract best bid/ask

3. OrderbookAggregator.process(symbol, bid, ask)
   └─> Accumulate in current 15s window

4. After 15 seconds
   └─> aggregator.flush()
       └─> Calculate avg/min/max
       └─> INSERT INTO {exchange}_snapshots

5. After 4 snapshots (1 minute)
   └─> Aggregate snapshots → 1 minute average
   └─> INSERT INTO {exchange}_minutes
   └─> DELETE old snapshots
```

### Arbitrage Detection Flow

```
1. API Request: GET /api/arbitrage?symbol=BTC&minProfit=0.5

2. ArbitrageCalculator.calculate()
   ├─> Query: SELECT latest FROM lighter_snapshots WHERE symbol='BTC'
   └─> Query: SELECT latest FROM paradex_snapshots WHERE symbol='BTC'

3. Compare all pairs:
   ├─> Lighter → Paradex: profit = paradex.bid - lighter.ask
   └─> Paradex → Lighter: profit = lighter.bid - paradex.ask

4. Filter: profitPercent >= 0.5

5. Sort by profitPercent DESC

6. Return JSON response
```

### Alert Flow

```
1. Cron Trigger (every minute)
   └─> scheduled() handler

2. AlertManager.checkAlerts()
   └─> For each enabled config:
       ├─> ArbitrageCalculator.calculate(config.exchanges, config.symbols, config.minProfit)
       └─> For each opportunity:
           ├─> Check cooldown (has it been alerted recently?)
           ├─> If new → Create AlertEvent
           ├─> Send to channels (Webhook/Console)
           └─> Mark as sent, update cooldown

3. Alert sent via Webhook
   └─> POST to configured URL with Slack/Discord/Custom template
```

---

## Storage Architecture

### Table Relationships

```
lighter_markets (1) ─────── (N) lighter_snapshots
       │                            │
       │                            │ (aggregated to)
       │                            ▼
       └─────────────────── (N) lighter_minutes

Same pattern for paradex_*
```

### Data Lifecycle

```
┌──────────────────────────────────────────────────────────┐
│                   Orderbook Update                        │
└──────────────────────────────────────────────────────────┘
                        │
                        ▼
                 ┌──────────────┐
                 │  In-Memory   │  ← 15 seconds
                 │  Aggregation │
                 └──────────────┘
                        │
                        ▼
                ┌───────────────┐
                │   Snapshots   │   ← Temporary
                │   (15s data)  │
                └───────────────┘
                        │
                        │ (4 snapshots)
                        ▼
                ┌───────────────┐
                │    Minutes    │   ← 1 hour retention
                │   (1min avg)  │
                └───────────────┘
                        │
                        │ (automatic cleanup)
                        ▼
                   [Deleted]
```

---

## Arbitrage Detection

### Calculation Strategy

**Option A: Pre-calculated (Rejected)**
- Store arbitrage in separate table
- Recalculate every window
- Cons: Extra DB writes, stale data

**Option B: Dynamic Calculation (Implemented) ✅**
- Calculate on-demand via API
- Always uses fresh data
- Minimal DB overhead
- Flexible filtering

### Implementation Details

```typescript
// worker/src/arbitrage.ts

class ArbitrageCalculator {
  async calculate(exchanges, symbol, minProfit, useMinutes) {
    // 1. Fetch latest prices from all exchanges
    const pricesByExchange = await Promise.all(
      exchanges.map(ex => this.getLatestPrices(ex, symbol, useMinutes))
    );

    // 2. Group by symbol
    const pricesBySymbol = /* ... */;

    // 3. Compare all pairs
    for (const [sym, prices] of pricesBySymbol) {
      for (let i = 0; i < prices.length; i++) {
        for (let j = i + 1; j < prices.length; j++) {
          // Calculate both directions
          const profit1 = prices[j].bid - prices[i].ask;
          const profit2 = prices[i].bid - prices[j].ask;

          // Add profitable opportunities
        }
      }
    }

    // 4. Sort and return
    return opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
  }
}
```

---

## Alert System

### Architecture Choice: Option B (Separate Worker)

**Why Separate?**
- ✅ **No interference** with tracking DOs
- ✅ **Independent scaling**
- ✅ **Flexible alerting** channels
- ✅ **Easy to disable** without affecting tracking

### Alert Manager State

```typescript
interface AlertState {
  lastAlertTime: Map<string, number>;  // cooldown tracking
  recentAlerts: AlertEvent[];           // history (last 100)
}
```

### Cooldown Mechanism

```
Alert Key: "BTC-lighter-paradex"

Timeline:
10:00:00  Alert sent ✅
10:01:00  Skipped (cooldown)
10:02:00  Skipped (cooldown)
10:04:59  Skipped (cooldown)
10:05:01  Alert sent ✅ (5min cooldown expired)
```

### Channel Support

1. **Webhook** (Primary)
   - Slack template
   - Discord template
   - Custom JSON

2. **Console** (Testing)
   - JSON format
   - Text format

3. **Email** (Future)
   - Via Cloudflare Email Routing
   - Or external SMTP

---

## Scalability

### Horizontal Scalability

**Adding New Exchanges:**

1. Create new tracker DO (e.g., `binance-new.ts`)
2. Add DB tables (`binance_markets`, `binance_snapshots`, `binance_minutes`)
3. Add binding in `wrangler.toml`
4. Export from `worker-new.ts`
5. **Arbitrage works automatically** 🎉

```typescript
// No code changes needed in arbitrage calculator!
const opportunities = await calculator.calculate(
  ['lighter', 'paradex', 'binance'],  // Just add exchange name
  'BTC'
);
```

### Vertical Scalability

**Current Limits:**
- **Durable Object Memory**: 128 MB (we use ~75 KB ✅)
- **D1 Database**: 10 GB (we store ~1h of minute data)
- **WebSocket Connections**: Unlimited per DO

**Optimization Opportunities:**
- Increase aggregation window (15s → 30s) → Less DB writes
- Reduce retention (1h → 30min) → Less storage
- Add caching for frequently queried data

### Performance Metrics

**Current Performance:**
- **Memory**: 75 KB per tracker DO (constant)
- **DB Writes**: ~4 per minute per symbol per exchange
- **API Response Time**: <100ms for arbitrage calculation
- **WebSocket Latency**: <50ms for orderbook updates

---

## Technology Stack

### Cloudflare Stack

- **Cloudflare Workers**: Serverless edge compute
- **Durable Objects**: Stateful WebSocket handlers
- **D1 Database**: SQLite at the edge
- **Cron Triggers**: Scheduled tasks

### Languages & Libraries

- **TypeScript**: Type-safe development
- **WebSocket API**: Native browser/worker API
- **SQL**: D1 database queries

### External APIs

- **Lighter API**: `https://mainnet.zklighter.elliot.ai`
- **Paradex API**: `https://api.prod.paradex.trade`

---

## Deployment Architecture

```
GitHub Repository
       │
       │ (git push)
       ▼
Cloudflare Workers
       │
       ├─> LighterTracker DO (auto-created on first request)
       ├─> ParadexTracker DO (auto-created on first request)
       ├─> AlertManager DO (created by cron)
       │
       ├─> D1 Database (shared across all DOs)
       │
       └─> Cron Trigger (runs every minute)
```

### Migrations

```toml
# wrangler.toml
[[migrations]]
tag = "v6-alerts"
new_classes = ["AlertManager"]
```

**Migration Process:**
1. Deploy new code
2. Cloudflare creates new DO class
3. Old DOs continue running
4. New requests use new DO class

---

## Security Considerations

### Authentication

Currently **no authentication** on API endpoints.

**Recommendations for Production:**
- Add API key authentication
- Rate limiting per IP/key
- CORS restrictions

### Data Privacy

- No personal data stored
- Only market prices (public data)
- Alert configs stored in DO state (not persistent)

### WebSocket Security

- TLS encryption (wss://)
- No credentials required for public orderbook data
- Exchange rate limits respected

---

## Monitoring & Observability

### Logging

All components log to Cloudflare Workers logs:

```typescript
console.log('[Lighter] ✅ Connected');
console.log('[Paradex] 📊 Filtered 15 PERP markets');
console.log('[AlertManager] 🚨 Alert triggered: BTC 0.52%');
```

### Metrics (Available)

- Messages received per exchange
- Markets loaded
- Snapshots/Minutes in DB
- Alert count
- Cooldown skips

### Health Checks

```bash
# Check Lighter status
curl https://<url>/api/lighter/stats

# Check Paradex status
curl https://<url>/api/paradex/stats

# Check recent alerts
curl https://<url>/api/alerts/alerts
```

---

## Future Enhancements

### Short Term

1. **Email Alerts** via Cloudflare Email Routing
2. **Telegram Bot** integration
3. **Fee Calculation** in arbitrage
4. **Historical Charts** in frontend

### Long Term

1. **More Exchanges** (Binance, Coinbase, etc.)
2. **ML-based** arbitrage prediction
3. **Auto-execution** integration
4. **Advanced filtering** (volume, liquidity)

---

## File Structure

```
lighter-price-monitor-v2/
├── worker/
│   ├── src/
│   │   ├── worker-new.ts          # Main worker (routing)
│   │   ├── lighter-new.ts         # Lighter tracker DO
│   │   ├── paradex-new.ts         # Paradex tracker DO
│   │   ├── aggregator-new.ts      # Streaming aggregator
│   │   ├── arbitrage.ts           # Arbitrage calculator
│   │   ├── alert-manager.ts       # Alert manager DO
│   │   └── alerts.ts              # Alert types & templates
│   ├── wrangler.toml              # Cloudflare config
│   ├── schema-new.sql             # Lighter DB schema
│   └── schema-paradex.sql         # Paradex DB schema
└── docs/
    ├── API.md                     # API documentation
    ├── ARBITRAGE.md               # Arbitrage explanation
    └── ARCHITECTURE.md            # This file
```

---

## References

- [API Documentation](./API.md)
- [Arbitrage Calculation](./ARBITRAGE.md)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [D1 Database](https://developers.cloudflare.com/d1/)
