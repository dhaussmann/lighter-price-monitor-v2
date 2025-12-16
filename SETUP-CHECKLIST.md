# ✅ Setup Checklist - Lighter Orderbook Tracker

## 📦 Dateien erstellt

### Core Implementation
- [x] `worker/src/aggregator-new.ts` - Streaming Aggregator (293 Zeilen)
- [x] `worker/src/lighter-new.ts` - Lighter Tracker DO (461 Zeilen)
- [x] `worker/src/worker-new.ts` - Main Worker + API + Frontend (515 Zeilen)

### Configuration & Schema
- [x] `worker/schema-new.sql` - Clean Database Schema
- [x] `worker/wrangler-new.toml` - Wrangler Config

### Documentation
- [x] `DEPLOYMENT-GUIDE.md` - Vollständiger Deployment-Guide
- [x] `SETUP-CHECKLIST.md` - Diese Datei

### Backup
- [x] `worker/backup/*.ts` - Backup der alten Files

---

## 🚀 Deployment Steps (Kopiere & Führe aus)

```bash
# === Schritt 1: Database Setup ===
cd /home/user/lighter-price-monitor-v2/worker

# Reset alte Tabellen (optional)
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS orderbook_entries"
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS orderbook_snapshots"
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS orderbook_minutes"
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS paradex_trades"
wrangler d1 execute DB --remote --command "DROP TABLE IF EXISTS token_mapping"

# Neue Schema erstellen
wrangler d1 execute DB --remote --file=schema-new.sql

# Verify
wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type='table'"

# === Schritt 2: Code Deployment ===

# Backup alte Config
cp wrangler.toml wrangler.toml.backup

# Aktiviere neue Config
cp wrangler-new.toml wrangler.toml

# Deploy!
npx wrangler deploy

# === Schritt 3: Test ===

# Öffne Frontend
# URL: https://lighter-orderbook-tracker.YOUR-SUBDOMAIN.workers.dev

# Teste API
curl https://YOUR-WORKER.workers.dev/api/stats | jq
curl https://YOUR-WORKER.workers.dev/api/markets | jq

# Live Logs
npx wrangler tail
```

---

## 📊 Was ist NEU?

### Architektur
| Alt | Neu |
|-----|-----|
| Multi-DO (Lighter + Paradex) | Single DO (nur Lighter) |
| Direkte DB Inserts | Streaming Aggregation |
| ~1000+ Inserts/min | ~4 Snapshots/min |
| Memory wächst | Memory konstant ~75KB |
| Komplexes Setup | Einfaches Setup |

### Market Mapping
**Alt:**
- API: `https://mainnet.zklighter.elliot.ai/api/v1/orderBooks`
- Problem: Komplexe Struktur, Extraktion nötig

**Neu:**
- API: `https://explorer.elliot.ai/api/markets`
- Format: `[{symbol: "ETH", market_index: 1}, ...]`
- Clean & Simple!

### Datenfluss
```
Lighter WebSocket
  ↓
Process Orderbook (beste Bid/Ask)
  ↓
Aggregator.process(symbol, bid, ask)
  ↓
[Memory Window: 15s]
  ↓
Flush → lighter_snapshots
  ↓
[4 Snapshots = 1 Minute]
  ↓
Calculate Average → lighter_minutes
  ↓
Cleanup old snapshots
```

---

## 🎯 Checkliste für Erfolgreiches Deployment

### Vor dem Deployment
- [ ] Datenbank-Reset durchgeführt
- [ ] Neue Schema erstellt
- [ ] Tabellen verifiziert

### Nach dem Deployment
- [ ] Frontend öffnet ohne Fehler
- [ ] WebSocket verbindet (Check logs)
- [ ] Status zeigt "CONNECTING..." → "STOPPED"
- [ ] Start Button funktioniert
- [ ] Nach Start: Status = "TRACKING"
- [ ] Messages Counter steigt
- [ ] Markets > 0
- [ ] Logs zeigen Activity

### Nach 1 Minute
- [ ] Snapshots in DB (>0)
- [ ] Minutes in DB (>0)
- [ ] API `/api/stats` funktioniert
- [ ] API `/api/markets` zeigt Markets
- [ ] API `/api/minutes` zeigt Daten

### Monitoring (kontinuierlich)
- [ ] Keine Memory-Limit Errors
- [ ] WebSocket bleibt connected
- [ ] Messages kommen kontinuierlich
- [ ] Aggregator flushed regelmäßig (alle 15s)
- [ ] Minuten-Aggregation läuft (alle 60s)

---

## 🐛 Troubleshooting

### "Keine Daten kommen"

**1. Check WebSocket:**
```bash
npx wrangler tail
# Suche: "[Lighter] ✅ WebSocket connected"
```

**2. Check Markets:**
```bash
wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM lighter_markets"
# Sollte > 0 sein
```

**3. Check Messages:**
```
Frontend: Messages Counter muss steigen
Logs: "[Lighter] Message received" sollte regelmäßig kommen
```

### "Memory Limit Error"

**Das sollte NICHT mehr passieren!**

Falls doch:
1. Check Aggregator Window Size
2. Erhöhe `windowDuration` auf 30000 (30s)
3. Reduce Markets (Filter in loadMarkets())

### "Keine Minuten-Aggregation"

Check Logs für:
```
[Aggregator] 📊 Calculating minute average for...
[Aggregator] ✅ Aggregated XX minute averages
```

Falls fehlt:
- Window-Position Bug → Check Code
- Snapshots fehlen → Check Flush Logs

---

## 📈 Performance Metriken

### Memory
- **Target:** < 100 KB
- **Aktuell:** ~75 KB
- **Monitoring:** Check Cloudflare Dashboard

### Database Writes
- **Snapshots:** ~4 writes/min/symbol
- **Minutes:** 1 write/min/symbol
- **Bei 100 Symbolen:** ~400 writes/min (vs 10,000+ vorher!)

### WebSocket
- **Messages:** ~1000+/min (abhängig von Market Activity)
- **Ping:** Alle 30s
- **Reconnect:** Auto nach 5s bei Disconnect

---

## 🎉 Success Criteria

Du weißt dass alles funktioniert wenn:

1. ✅ Frontend zeigt "🟢 TRACKING"
2. ✅ Markets Count > 100
3. ✅ Messages Counter steigt kontinuierlich
4. ✅ Last Message = "Xs ago" (< 5s)
5. ✅ Snapshots in DB wachsen
6. ✅ Minutes in DB wachsen
7. ✅ Logs zeigen Flush + Aggregation
8. ✅ API liefert sinnvolle Daten
9. ✅ Keine Errors in Logs
10. ✅ Memory bleibt konstant

---

## 📞 Next Steps

Nach erfolgreichem Deployment:

1. **Monitoring Setup**
   - Cloudflare Analytics Dashboard
   - Custom Alerts für Disconnects
   - Memory Usage Monitoring

2. **API Integration**
   - Baue Charts mit `/api/minutes` Daten
   - Historical Data Export
   - Real-time Updates via WebSocket

3. **Features erweitern**
   - Paradex hinzufügen (später)
   - Mehr Aggregation Levels (5min, 1h)
   - Trade Volume Tracking
   - Spread Analysis

4. **Production Hardening**
   - Rate Limiting
   - Error Handling verbessern
   - Backup Strategy
   - Disaster Recovery Plan

---

**Viel Erfolg! 🚀**

Bei Fragen → Check `DEPLOYMENT-GUIDE.md`
