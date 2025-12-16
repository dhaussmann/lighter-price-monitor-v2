# Arbitrage Calculation

Understanding Cross-Exchange Arbitrage Detection

---

## Table of Contents

- [What is Arbitrage?](#what-is-arbitrage)
- [Price Components](#price-components)
- [Calculation Logic](#calculation-logic)
- [Examples](#examples)
- [Multi-Exchange Arbitrage](#multi-exchange-arbitrage)
- [Considerations](#considerations)
- [Code Implementation](#code-implementation)

---

## What is Arbitrage?

**Arbitrage** is the simultaneous purchase and sale of an asset on different exchanges to profit from price differences.

**Goal:** Buy low on Exchange A, sell high on Exchange B → Profit

---

## Price Components

### Bid and Ask

**Ask Price** (Seller's price):
- Price you **pay** when buying
- Always higher than bid
- "Selling to you at this price"

**Bid Price** (Buyer's price):
- Price you **receive** when selling
- Always lower than ask
- "Buying from you at this price"

**Example:**
```
Lighter Exchange:
├── Best Bid: $98,200 (someone wants to buy at this price)
└── Best Ask: $98,250 (someone wants to sell at this price)

Paradex Exchange:
├── Best Bid: $98,500 (someone wants to buy at this price)
└── Best Ask: $98,550 (someone wants to sell at this price)
```

---

## Calculation Logic

### Formula

```
Arbitrage Profit = Sell Price (Exchange B) - Buy Price (Exchange A)

Where:
- Buy Price = Ask on Exchange A (price you pay)
- Sell Price = Bid on Exchange B (price you receive)

Profit Percentage = (Profit / Buy Price) × 100
```

### Two Directions

For every pair of exchanges, we check **both directions**:

1. **Buy A → Sell B**: Buy on Exchange A, sell on Exchange B
2. **Buy B → Sell A**: Buy on Exchange B, sell on Exchange A

Only one direction will typically be profitable (or neither).

---

## Examples

### Example 1: Profitable Arbitrage

**Market Prices:**
```
Lighter:
  Bid: $98,200
  Ask: $98,250

Paradex:
  Bid: $98,500
  Ask: $98,550
```

**Direction 1: Lighter → Paradex**
```
1. Buy BTC on Lighter at $98,250 (Ask)
2. Sell BTC on Paradex at $98,500 (Bid)

Profit = $98,500 - $98,250 = $250
Profit % = ($250 / $98,250) × 100 = 0.25%

✅ Profitable arbitrage opportunity!
```

**Direction 2: Paradex → Lighter**
```
1. Buy BTC on Paradex at $98,550 (Ask)
2. Sell BTC on Lighter at $98,200 (Bid)

Profit = $98,200 - $98,550 = -$350
Profit % = (-$350 / $98,550) × 100 = -0.36%

❌ Negative profit, not an arbitrage
```

### Example 2: No Arbitrage

**Market Prices:**
```
Lighter:
  Bid: $98,200
  Ask: $98,250

Paradex:
  Bid: $98,220
  Ask: $98,270
```

**Direction 1: Lighter → Paradex**
```
Buy: $98,250 (Lighter Ask)
Sell: $98,220 (Paradex Bid)
Profit: $98,220 - $98,250 = -$30

❌ Negative profit
```

**Direction 2: Paradex → Lighter**
```
Buy: $98,270 (Paradex Ask)
Sell: $98,200 (Lighter Bid)
Profit: $98,200 - $98,270 = -$70

❌ Negative profit
```

**Result**: No arbitrage opportunity between these exchanges.

---

## Multi-Exchange Arbitrage

### 2 Exchanges

With 2 exchanges, there are **2 directions**:
- Lighter → Paradex
- Paradex → Lighter

### 3 Exchanges

With 3 exchanges (Lighter, Paradex, Binance), there are **6 directions**:
- Lighter → Paradex
- Lighter → Binance
- Paradex → Lighter
- Paradex → Binance
- Binance → Lighter
- Binance → Paradex

### N Exchanges

**Formula**: N × (N - 1) directions

**Implementation:**
```typescript
for (let i = 0; i < exchanges.length; i++) {
  for (let j = i + 1; j < exchanges.length; j++) {
    // Compare exchange i vs exchange j in both directions
  }
}
```

This ensures all possible pairs are checked.

---

## Considerations

### 1. Trading Fees (Not Included)

Our calculation **does not include** exchange fees:

```
Actual Profit = Arbitrage Profit - Fee(Exchange A) - Fee(Exchange B)
```

**Example with fees:**
```
Arbitrage Profit: $250 (0.25%)
Lighter Fee (0.1%): $98.25
Paradex Fee (0.1%): $98.50
Real Profit: $250 - $98.25 - $98.50 = $53.25 (0.05%)
```

### 2. Slippage

Prices are **averages** over 15-second windows:
- Real-time prices may differ
- Large orders may experience slippage
- Actual execution price might be worse than calculated

### 3. Data Freshness

The `dataAge` field indicates how old the data is:

```json
{
  "dataAge": 1250  // milliseconds since last update
}
```

**Best Practice**: Filter opportunities with `dataAge < 5000` (5 seconds) for more reliable data.

### 4. Execution Risk

**Speed matters**: Prices change rapidly. By the time you:
1. Detect arbitrage
2. Place buy order
3. Wait for confirmation
4. Place sell order
5. Wait for confirmation

...the opportunity may have disappeared.

### 5. Capital Requirements

**Two-way arbitrage** requires:
- Capital on both exchanges
- Or fast transfer mechanism (risky due to price movement)

### 6. Withdrawal Limits

Some exchanges have:
- Withdrawal limits
- Withdrawal fees
- Withdrawal delays

This affects profitability and capital efficiency.

---

## Code Implementation

### Data Source

Prices come from aggregated snapshots:

```sql
SELECT
  symbol,
  timestamp,
  avg_bid as bid,  -- Average bid over 15s window
  avg_ask as ask,  -- Average ask over 15s window
  avg_spread as spread
FROM lighter_snapshots
WHERE timestamp IN (
  SELECT MAX(timestamp)
  FROM lighter_snapshots
  GROUP BY symbol
)
```

### Calculation (worker/src/arbitrage.ts)

```typescript
// For each pair of exchanges
for (let i = 0; i < prices.length; i++) {
  for (let j = i + 1; j < prices.length; j++) {
    const price1 = prices[i];
    const price2 = prices[j];

    // Direction 1: Buy from exchange1, sell to exchange2
    const profit1 = price2.bid - price1.ask;
    const profitPercent1 = (profit1 / price1.ask) * 100;

    if (profitPercent1 >= minProfitPercent) {
      opportunities.push({
        symbol,
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
        symbol,
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

// Sort by profitPercent (descending)
opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
```

### Filtering

**Minimum Profit Threshold:**
```typescript
if (profitPercent1 >= minProfitPercent) {
  // Include this opportunity
}
```

**Example**: Setting `minProfit=0.5` filters out opportunities below 0.5% profit.

---

## Visual Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Arbitrage Detection                     │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Fetch Latest Prices │
                    └──────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                  ▼
    ┌──────────────────┐              ┌──────────────────┐
    │ Lighter Snapshot │              │ Paradex Snapshot │
    │                  │              │                  │
    │ BTC              │              │ BTC              │
    │ Bid: $98,200     │              │ Bid: $98,500     │
    │ Ask: $98,250     │              │ Ask: $98,550     │
    └──────────────────┘              └──────────────────┘
              │                                  │
              └────────────────┬────────────────┘
                               ▼
                    ┌──────────────────────┐
                    │  Compare All Pairs   │
                    └──────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                  ▼
    ┌──────────────────┐              ┌──────────────────┐
    │   Direction 1    │              │   Direction 2    │
    │                  │              │                  │
    │ Buy: Lighter     │              │ Buy: Paradex     │
    │ Sell: Paradex    │              │ Sell: Lighter    │
    │                  │              │                  │
    │ Profit: $250     │              │ Profit: -$350    │
    │ Profit%: 0.25%   │              │ Profit%: -0.36%  │
    │ ✅ PROFITABLE    │              │ ❌ NOT PROFITABLE│
    └──────────────────┘              └──────────────────┘
              │
              ▼
    ┌──────────────────┐
    │  Sort by Profit% │
    └──────────────────┘
              │
              ▼
    ┌──────────────────┐
    │  Return Results  │
    └──────────────────┘
```

---

## API Usage Example

**Find BTC arbitrage with minimum 0.5% profit:**

```bash
curl "https://<url>/api/arbitrage?symbol=BTC&minProfit=0.5"
```

**Response:**
```json
{
  "opportunities": [
    {
      "symbol": "BTC",
      "buyFrom": "lighter",
      "sellTo": "paradex",
      "buyPrice": 98250.00,
      "sellPrice": 98500.00,
      "profit": 250.00,
      "profitPercent": 0.25,
      "timestamp": 1734352800000,
      "dataAge": 1250
    }
  ],
  "count": 1
}
```

**Interpretation:**
- Buy BTC on Lighter at $98,250
- Sell BTC on Paradex at $98,500
- Theoretical profit: $250 (0.25%)
- Data is 1.25 seconds old

---

## Risk Disclaimer

This system calculates **theoretical** arbitrage opportunities based on historical aggregated data. **It does not account for:**

- Trading fees
- Slippage
- Execution delays
- Market impact
- Withdrawal fees/limits
- Network congestion
- Exchange downtime

**Always conduct your own research and risk assessment before trading.**

---

## Further Reading

- [API Documentation](./API.md)
- [Architecture](./ARCHITECTURE.md)
- [Alert System](../worker/src/alerts.ts)
