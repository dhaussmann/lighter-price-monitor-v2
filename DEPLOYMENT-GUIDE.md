# 🚀 Deployment Guide - Lighter Orderbook Tracker (Clean)

## Übersicht

Kompletter Neuaufbau mit:
- ✅ Nur Lighter (kein Paradex)
- ✅ Streaming Aggregation (15s Windows)
- ✅ Memory-effizient (~50 KB konstant)
- ✅ Einfaches Frontend (Start/Stop + Stats)
- ✅ Clean API
- ✅ Detailliertes Logging

---

## Schritt 1: Database Setup

### 1.1 Datenbank resetten (optional, empfohlen)

```bash
cd worker

# Alle alten Daten löschen
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS orderbook_entries"
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS orderbook_snapshots"
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS orderbook_minutes"
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS paradex_trades"
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS token_mapping"
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS tracking_stats"
```

### 1.2 Neue Schema erstellen

```bash
wrangler d1 execute DB --remote --file=schema-new.sql
```

**Verifizieren:**
```bash
wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

Erwartetes Output:
- `lighter_markets`
- `lighter_snapshots`
- `lighter_minutes`
- `tracking_stats`

---

## Schritt 2: Code deployen

### 2.1 Backup alte Config

```bash
cp wrangler.toml wrangler.toml.backup
```

### 2.2 Neue Config aktivieren

```bash
cp wrangler-new.toml wrangler.toml
```

### 2.3 Worker deployen

```bash
npx wrangler deploy
```

---

## Schritt 3: Testen

### 3.1 Frontend öffnen

Öffne die URL die `wrangler deploy` ausgibt, z.B.:
```
https://lighter-orderbook-tracker.YOUR-SUBDOMAIN.workers.dev
```

### 3.2 Tracking starten

1. Klicke "START TRACKING"
2. Warte ~10 Sekunden
3. Überprüfe dass:
   - Status = "🟢 TRACKING"
   - Messages Counter steigt
   - Markets > 0
   - Log zeigt Activity

### 3.3 Daten überprüfen

Nach 1-2 Minuten sollten Daten in DB sein:

```bash
# Snapshots prüfen
wrangler d1 execute DB --remote --command "SELECT COUNT(*) as count FROM lighter_snapshots"

# Minuten prüfen
wrangler d1 execute DB --remote --command "SELECT COUNT(*) as count FROM lighter_minutes"

# Sample Daten
wrangler d1 execute DB --remote --command "SELECT * FROM lighter_minutes ORDER BY timestamp DESC LIMIT 5"
```

---

## Schritt 4: API testen

### Get Stats
```bash
curl https://YOUR-WORKER.workers.dev/api/stats | jq
```

### Get Markets
```bash
curl https://YOUR-WORKER.workers.dev/api/markets | jq
```

### Get Latest Minutes (ETH)
```bash
curl "https://YOUR-WORKER.workers.dev/api/minutes?symbol=ETH&limit=10" | jq
```

### Get Overview
```bash
curl https://YOUR-WORKER.workers.dev/api/overview | jq
```

---

## Schritt 5: Logs überwachen

### Live Logs
```bash
npx wrangler tail
```

**Was du sehen solltest:**
```
[Lighter] 🎬 Durable Object created
[Lighter] 📂 Loaded state: isTracking=false
[Lighter] ▶️ Starting tracking...
[Lighter] 🔧 Initializing...
[Aggregator] 🎬 Started - Window: 15000ms
[Lighter] 🔍 Loading markets from API...
[Lighter] 📋 Received XXX markets from API
[Lighter] ✅ Loaded XXX markets
[Lighter] 🔌 Connecting to WebSocket...
[Lighter] ✅ WebSocket connected
[Lighter] 📡 Subscribing to XXX markets...
[Aggregator] 💾 Flushing XX symbols for window 2025-12-16T...
[Aggregator] ✅ Flushed XX snapshots
[Aggregator] 📊 Calculating minute average for 2025-12-16T...
[Aggregator] ✅ Aggregated XX minute averages
[Aggregator] 🧹 Cleaned old snapshots
```

---

## Schritt 6: Troubleshooting

### Problem: Keine Daten kommen

**Check 1: WebSocket verbunden?**
```
Logs: "[Lighter] ✅ WebSocket connected"
```

**Check 2: Markets geladen?**
```
Logs: "[Lighter] ✅ Loaded XXX markets"
Frontend: Markets > 0
```

**Check 3: Messages kommen?**
```
Frontend: Messages Counter steigt
```

### Problem: Memory Limit Error

**Das sollte nicht mehr passieren!** Falls doch:
1. Stoppe Tracking
2. Prüfe Aggregator Logs
3. Erhöhe `windowDuration` auf 30s (in aggregator-new.ts)

### Problem: Keine Minuten-Aggregation

**Nach 1 Minute sollten Daten in `lighter_minutes` sein:**

```bash
wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM lighter_minutes"
```

Falls 0: Check Logs für Aggregator Fehler

---

## Architektur-Übersicht

```
┌─────────────────────────────────────────┐
│ Frontend (Dashboard)                     │
│ - Start/Stop Button                     │
│ - Live Stats                             │
│ - WebSocket Connection                   │
└───────────────┬─────────────────────────┘
                │
                │ WS /ws
                ↓
┌─────────────────────────────────────────┐
│ Main Worker (worker-new.ts)             │
│ - API Endpoints                          │
│ - WebSocket Routing                      │
│ - Frontend Serving                       │
└───────────────┬─────────────────────────┘
                │
                │ Route to DO
                ↓
┌─────────────────────────────────────────┐
│ LighterTracker (Durable Object)         │
│ - Load Markets from API                  │
│ - WebSocket to Lighter                   │
│ - Process Orderbook Updates              │
│ - Feed to Aggregator                     │
└───────────────┬─────────────────────────┘
                │
                │ processUpdate()
                ↓
┌─────────────────────────────────────────┐
│ OrderbookAggregator                     │
│ - 15s Window in Memory                   │
│ - Auto-flush every 15s                   │
│ - Calculate minute averages              │
│ - Write to D1                            │
└───────────────┬─────────────────────────┘
                │
                │ Batch Insert
                ↓
┌─────────────────────────────────────────┐
│ D1 Database                              │
│ - lighter_markets (mapping)              │
│ - lighter_snapshots (15s, temporary)     │
│ - lighter_minutes (1h retention)         │
└─────────────────────────────────────────┘
```

---

## Memory Footprint

| Component | Memory |
|-----------|--------|
| LighterTracker Base | ~10 KB |
| Markets Map | ~5 KB (200 markets) |
| Aggregator Window | ~50 KB (200 symbols) |
| WebSocket Buffer | ~10 KB |
| **Total** | **~75 KB** |

**Vs Previous:**
- Old: 5-10 MB (wuchs ständig)
- New: ~75 KB (konstant!)

---

## API Dokumentation

### GET /api/stats
Aktuelle Tracker-Statistiken

**Response:**
```json
{
  "isTracking": true,
  "markets": 123,
  "connected": true,
  "messagesReceived": 45678,
  "lastMessageAt": 1702742400000,
  "database": {
    "snapshots": 456,
    "minutes": 2340
  },
  "aggregator": {
    "currentSymbols": 45,
    "windowElapsed": 8234
  }
}
```

### GET /api/markets
Alle Markets

**Response:**
```json
{
  "markets": [
    { "market_index": 1, "symbol": "ETH", "active": 1 },
    { "market_index": 2, "symbol": "BTC", "active": 1 }
  ],
  "count": 2
}
```

### GET /api/minutes?symbol=ETH&limit=10
Minuten-Aggregationen

**Query Params:**
- `symbol` (optional): Filter by symbol
- `limit` (default: 60): Limit results
- `offset` (default: 0): Pagination
- `from` (optional): Timestamp filter
- `to` (optional): Timestamp filter

**Response:**
```json
{
  "minutes": [
    {
      "symbol": "ETH",
      "timestamp": 1702742400000,
      "avg_bid": 2234.56,
      "avg_ask": 2235.12,
      "avg_spread": 0.56,
      "tick_count": 234
    }
  ],
  "count": 10
}
```

---

## Erfolg! 🎉

Wenn alles funktioniert siehst du:
1. ✅ Frontend zeigt "🟢 TRACKING"
2. ✅ Messages Counter steigt kontinuierlich
3. ✅ Snapshots & Minutes in DB wachsen
4. ✅ Keine Memory-Errors in Logs
5. ✅ API liefert Daten

**Nächste Schritte:**
- Monitoring einrichten
- Alerts für Disconnects
- Paradex hinzufügen (später)
- Historical Data Export
