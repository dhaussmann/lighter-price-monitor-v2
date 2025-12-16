# API Documentation

Multi-Exchange Orderbook Tracking API with Real-time Arbitrage Detection

Base URL: `https://lighter-orderbook-tracker.<subdomain>.workers.dev`

---

## Table of Contents

- [Exchange APIs](#exchange-apis)
  - [Lighter](#lighter-api)
  - [Paradex](#paradex-api)
- [Arbitrage API](#arbitrage-api)
- [Alert Manager API](#alert-manager-api)
- [Response Formats](#response-formats)
- [Error Handling](#error-handling)

---

## Exchange APIs

### Lighter API

All Lighter endpoints are prefixed with `/api/lighter`

#### GET /api/lighter/stats

Get real-time tracker statistics.

**Response:**
```json
{
  "isTracking": true,
  "markets": 15,
  "messagesReceived": 127543,
  "database": {
    "snapshots": 245,
    "minutes": 180
  }
}
```

#### GET /api/lighter/markets

List all active Lighter markets.

**Response:**
```json
{
  "markets": [
    {
      "market_index": 1,
      "symbol": "ETH",
      "active": 1,
      "last_updated": 1734352800000
    }
  ],
  "count": 15
}
```

#### GET /api/lighter/snapshots

Query 15-second orderbook snapshots.

**Query Parameters:**
- `symbol` (optional): Filter by symbol (e.g., "BTC", "ETH")
- `limit` (optional, default: 100): Number of results
- `offset` (optional, default: 0): Pagination offset

**Example:**
```bash
curl "https://<url>/api/lighter/snapshots?symbol=BTC&limit=50"
```

**Response:**
```json
{
  "snapshots": [
    {
      "id": 12345,
      "symbol": "BTC",
      "timestamp": 1734352800000,
      "avg_bid": 98234.50,
      "avg_ask": 98236.20,
      "avg_spread": 1.70,
      "min_bid": 98230.00,
      "max_bid": 98240.00,
      "min_ask": 98232.00,
      "max_ask": 98242.00,
      "tick_count": 247,
      "created_at": 1734352800000
    }
  ],
  "count": 50,
  "pagination": {
    "limit": 50,
    "offset": 0
  }
}
```

#### GET /api/lighter/minutes

Query 1-minute aggregated data.

**Query Parameters:**
- `symbol` (optional): Filter by symbol
- `limit` (optional, default: 60): Number of results
- `offset` (optional, default: 0): Pagination offset
- `from` (optional): Start timestamp (Unix ms)
- `to` (optional): End timestamp (Unix ms)

**Example:**
```bash
curl "https://<url>/api/lighter/minutes?symbol=ETH&from=1734349200000&to=1734352800000"
```

**Response:**
```json
{
  "minutes": [
    {
      "id": 456,
      "symbol": "ETH",
      "timestamp": 1734352800000,
      "avg_bid": 3500.50,
      "avg_ask": 3502.00,
      "avg_spread": 1.50,
      "min_bid": 3498.00,
      "max_bid": 3503.00,
      "min_ask": 3500.00,
      "max_ask": 3505.00,
      "tick_count": 1024,
      "created_at": 1734352800000
    }
  ],
  "count": 60
}
```

#### GET /api/lighter/overview

Get overview statistics per symbol.

**Response:**
```json
{
  "symbols": [
    {
      "symbol": "BTC",
      "total_minutes": 180,
      "first_minute": 1734342000000,
      "last_minute": 1734352800000,
      "overall_avg_bid": 98250.00,
      "overall_avg_ask": 98252.50,
      "total_ticks": 184320
    }
  ],
  "count": 15
}
```

---

### Paradex API

All Paradex endpoints are prefixed with `/api/paradex` and follow the same structure as Lighter.

**Available Endpoints:**
- `GET /api/paradex/stats`
- `GET /api/paradex/markets`
- `GET /api/paradex/snapshots`
- `GET /api/paradex/minutes`
- `GET /api/paradex/overview`

**Note:** Response formats are identical to Lighter, only data source differs.

---

## Arbitrage API

### GET /api/arbitrage

Calculate real-time arbitrage opportunities across exchanges.

**Query Parameters:**
- `symbol` (optional): Filter by symbol (e.g., "BTC")
- `exchanges` (optional, default: "lighter,paradex"): Comma-separated exchange list
- `minProfit` (optional, default: 0): Minimum profit percentage threshold
- `useMinutes` (optional, default: false): Use minute data instead of snapshots

**Examples:**

All opportunities across all exchanges:
```bash
curl "https://<url>/api/arbitrage"
```

Only BTC with minimum 0.5% profit:
```bash
curl "https://<url>/api/arbitrage?symbol=BTC&minProfit=0.5"
```

Custom exchanges:
```bash
curl "https://<url>/api/arbitrage?exchanges=lighter,paradex,binance"
```

**Response:**
```json
{
  "opportunities": [
    {
      "symbol": "BTC",
      "buyFrom": "lighter",
      "sellTo": "paradex",
      "buyPrice": 98234.50,
      "sellPrice": 98450.00,
      "profit": 215.50,
      "profitPercent": 0.22,
      "timestamp": 1734352800000,
      "dataAge": 1250
    }
  ],
  "count": 1,
  "filters": {
    "symbol": "BTC",
    "exchanges": ["lighter", "paradex"],
    "minProfit": 0.5,
    "source": "snapshots"
  },
  "timestamp": 1734352801250
}
```

**Fields:**
- `buyPrice`: Ask price on buy exchange (price to pay when buying)
- `sellPrice`: Bid price on sell exchange (price received when selling)
- `profit`: Absolute profit in quote currency
- `profitPercent`: Percentage profit relative to buy price
- `dataAge`: Age of data in milliseconds (freshness indicator)

---

### GET /api/arbitrage/history

Query historical arbitrage opportunities.

**Query Parameters:**
- `symbol` (required): Symbol to analyze
- `exchanges` (optional, default: "lighter,paradex"): Comma-separated exchanges
- `from` (required): Start timestamp (Unix ms)
- `to` (required): End timestamp (Unix ms)
- `interval` (optional, default: "minutes"): "snapshots" or "minutes"

**Example:**
```bash
curl "https://<url>/api/arbitrage/history?symbol=BTC&from=1734349200000&to=1734352800000&interval=minutes"
```

**Response:**
```json
{
  "opportunities": [
    {
      "symbol": "BTC",
      "buyFrom": "lighter",
      "sellTo": "paradex",
      "buyPrice": 98100.00,
      "sellPrice": 98350.00,
      "profit": 250.00,
      "profitPercent": 0.25,
      "timestamp": 1734350400000,
      "dataAge": 0
    }
  ],
  "count": 45,
  "filters": {
    "symbol": "BTC",
    "exchanges": ["lighter", "paradex"],
    "from": 1734349200000,
    "to": 1734352800000,
    "interval": "minutes"
  }
}
```

---

## Alert Manager API

Manage arbitrage alerts and monitoring.

### POST /api/alerts/configs

Create or update an alert configuration.

**Request Body:**
```json
{
  "id": "btc-high-profit",
  "name": "BTC High Profit Alert",
  "enabled": true,
  "minProfitPercent": 0.5,
  "symbols": ["BTC"],
  "exchanges": ["lighter", "paradex"],
  "cooldownMinutes": 5,
  "channels": [
    {
      "type": "webhook",
      "enabled": true,
      "config": {
        "url": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
        "method": "POST",
        "template": "slack"
      }
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "config": { /* ... */ }
}
```

### GET /api/alerts/configs

List all alert configurations.

**Response:**
```json
{
  "configs": [
    {
      "id": "btc-high-profit",
      "name": "BTC High Profit Alert",
      "enabled": true,
      "minProfitPercent": 0.5,
      "symbols": ["BTC"],
      "exchanges": ["lighter", "paradex"],
      "cooldownMinutes": 5,
      "channels": [ /* ... */ ],
      "createdAt": 1734352800000,
      "updatedAt": 1734352800000
    }
  ],
  "count": 1
}
```

### DELETE /api/alerts/configs/:id

Delete an alert configuration.

**Response:**
```json
{
  "success": true
}
```

### GET /api/alerts/alerts

Get recent alert history.

**Query Parameters:**
- `limit` (optional, default: 20): Number of alerts to return

**Response:**
```json
{
  "alerts": [
    {
      "id": "alert-123",
      "configId": "btc-high-profit",
      "timestamp": 1734352800000,
      "opportunity": {
        "symbol": "BTC",
        "buyFrom": "lighter",
        "sellTo": "paradex",
        "buyPrice": 98234.50,
        "sellPrice": 98450.00,
        "profit": 215.50,
        "profitPercent": 0.22
      },
      "status": "sent",
      "channels": [
        {
          "type": "webhook",
          "status": "sent"
        }
      ]
    }
  ],
  "count": 1
}
```

### POST /api/alerts/start

Start alert monitoring.

**Request Body:**
```json
{
  "intervalMinutes": 1
}
```

**Response:**
```json
{
  "success": true,
  "message": "Monitoring started (interval: 1 min)"
}
```

### POST /api/alerts/stop

Stop alert monitoring.

**Response:**
```json
{
  "success": true,
  "message": "Monitoring stopped"
}
```

### POST /api/alerts/check

Manually trigger alert check.

**Response:**
```json
{
  "success": true,
  "message": "Alert check triggered"
}
```

---

## Response Formats

### Success Response

All successful API calls return JSON with appropriate data and metadata.

### Error Response

```json
{
  "error": "Error description"
}
```

**HTTP Status Codes:**
- `200 OK`: Success
- `400 Bad Request`: Invalid parameters
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

---

## Error Handling

### Common Errors

**Missing Required Parameters:**
```json
{
  "error": "Parameter 'symbol' is required"
}
```

**Database Error:**
```json
{
  "error": "Database error"
}
```

**Invalid Exchange:**
```json
{
  "error": "Need at least 2 exchanges for arbitrage calculation"
}
```

---

## Rate Limiting

Currently no rate limiting is enforced. Use responsibly.

---

## CORS

All endpoints support CORS with `Access-Control-Allow-Origin: *` for development.

---

## Webhook Templates

### Slack Template

```json
{
  "url": "https://hooks.slack.com/services/...",
  "method": "POST",
  "template": "slack"
}
```

### Discord Template

```json
{
  "url": "https://discord.com/api/webhooks/...",
  "method": "POST",
  "template": "discord"
}
```

### Custom Template

```json
{
  "url": "https://your-api.com/webhook",
  "method": "POST",
  "template": "default",
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

---

## Data Retention

- **Snapshots**: Temporary, used for real-time aggregation
- **Minutes**: 1 hour retention
- **Markets**: Persistent

---

## Best Practices

1. **Use `minProfit` filter** to reduce noise in arbitrage results
2. **Monitor `dataAge`** to ensure data freshness
3. **Use minute data for historical analysis** (more stable than snapshots)
4. **Set appropriate cooldowns** for alerts to prevent spam
5. **Test webhooks** with console channel first

---

## Support

For issues or feature requests, please visit the repository.
