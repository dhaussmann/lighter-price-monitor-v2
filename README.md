# 🚀 Lighter Price Monitor v2 - Persistent Background Monitoring

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![D1 Database](https://img.shields.io/badge/D1-Database-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![WebSocket](https://img.shields.io/badge/WebSocket-Real--time-green)](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Echtzeit-Preisüberwachung für Lighter DEX mit **persistentem Hintergrund-Monitoring**. Die Überwachung läuft permanent auf dem Server - auch wenn du die Website schließt!

## ⭐ Neu in Version 2.0

- ✅ **Persistentes Monitoring** - Überwachung läuft 24/7 auf dem Server
- ✅ **D1 Database** - Alert-Historie wird dauerhaft gespeichert
- ✅ **Offline-Fähig** - Verlasse die Website, Monitoring läuft weiter
- ✅ **Alert-Historie** - Vollständige Tabelle aller Preis-Alarme
- ✅ **Browser-Notifications** - Optional: Desktop-Benachrichtigungen
- ✅ **Statistiken** - Übersichtliche Anzeige aktiver Monitore und Alarme

## 🎯 Use Case

**Problem gelöst:** Du möchtest Preise überwachen, aber nicht ständig die Website offen haben?

**Lösung:** Aktiviere einen Monitor und schließe die Website. Das System überwacht den Preis permanent im Hintergrund. Kommst du später zurück, siehst du alle Preis-Alarme in der Historie-Tabelle!

## ✨ Features

### Persistentes Monitoring
- 🔄 **24/7 Überwachung** - Läuft auf Cloudflare Workers (serverless)
- 💾 **Dauerhafte Speicherung** - Alle Alarme in D1 Database
- 🔌 **Offline-Fähig** - Website kann geschlossen werden
- 🔁 **Auto-Reconnect** - Bei Verbindungsabbrüchen

### Alert-System
- 🔔 **Echtzeit-Alarme** - Sofortige Benachrichtigung bei Schwellwert
- 📊 **Historie-Tabelle** - Alle Alarme mit Zeitstempel
- 🎯 **Präzise Trigger** - Über/Unter Schwellwert konfigurierbar
- 🗑️ **Alert-Verwaltung** - Einzeln oder alle löschen

### Benutzerfreundlichkeit
- 🎨 **Moderne UI** - Futuristisches Design mit Animationen
- 📈 **Live-Statistiken** - Aktive Monitore, Gesamt-Alarme, Status
- 📱 **Responsive** - Desktop und Mobile
- 🌐 **Browser-Notifications** - Optional aktivierbar

## 🏗️ Architektur

```
┌─────────────────┐         WebSocket          ┌──────────────────────┐
│                 │ ◄──────────────────────────►│                      │
│  React Frontend │                             │ Cloudflare Worker    │
│  (Optional)     │                             │ + Durable Object     │
└─────────────────┘                             │                      │
                                                 │  ┌────────────────┐ │
                                                 │  │ Preis-         │ │
                                                 │  │ Monitoring     │ │
                                                 │  │ Logik          │ │
                                                 │  └────────┬───────┘ │
                                                 │           │         │
                                                 │           ▼         │
                                                 │  ┌────────────────┐ │
                                                 │  │ D1 Database    │ │
                                                 │  │ Alert-Historie │ │
                                                 │  └────────────────┘ │
                                                 └──────────┬───────────┘
                                                            │
                                                            │ WebSocket
                                                            ▼
                                                   ┌──────────────────┐
                                                   │   Lighter DEX    │
                                                   │   WebSocket API  │
                                                   └──────────────────┘
```

**Wichtig:** Monitoring läuft auf dem Server! Frontend ist nur für Konfiguration und Anzeige.

## 🚀 Installation & Deployment

### Schritt 1: D1 Database erstellen

```bash
cd worker

# D1 Database erstellen
npm run db:create

# Output enthält die Database-ID, z.B.:
# database_id = "abc123-def456-ghi789"

# Kopiere die Database-ID und füge sie in wrangler.toml ein
```

Öffne `wrangler.toml` und ersetze `YOUR_DATABASE_ID`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "lighter-alerts"
database_id = "abc123-def456-ghi789"  # <-- Deine Database-ID
```

### Schritt 2: Database Schema initialisieren

```bash
# Schema in Production-Database laden
npm run db:init

# Für lokale Entwicklung
npm run db:local-init
```

### Schritt 3: Worker deployen

```bash
npm install
npm run deploy
```

Notiere dir die Worker-URL aus dem Output:
```
https://lighter-price-monitor-v2.YOUR_SUBDOMAIN.workers.dev
```

### Schritt 4: Frontend konfigurieren

Öffne `frontend/index.html` und setze die WebSocket-URL (Zeile ~650):

```javascript
const WS_URL = 'wss://lighter-price-monitor-v2.YOUR_SUBDOMAIN.workers.dev/ws';
```

### Schritt 5: Frontend deployen

```bash
cd ../frontend
npx wrangler pages deploy . --project-name=lighter-monitor-v2
```

## 📖 Verwendung

### 1. Monitor erstellen

1. Gib **Token ID** ein (z.B. `WETH_USDC`)
2. Setze **Schwellwert** (Preis in USD)
3. Wähle **Typ**:
   - **↓ Unter Schwellwert** = Alarm wenn Preis fällt
   - **↑ Über Schwellwert** = Alarm wenn Preis steigt
4. Klicke **Monitor aktivieren**

### 2. Monitoring läuft automatisch

- ✅ Monitor ist aktiv (siehst du in der Tabelle)
- ✅ Überwachung läuft auf dem Server
- ✅ Website kann geschlossen werden!

### 3. Später zurückkommen

- Öffne die Website erneut
- Siehst du alle **Preis-Alarme** in der Historie-Tabelle
- Mit Zeitstempel, Preis, und Details

### 4. Alert-Historie verwalten

- **Einzelne Alarme**: (Feature kann hinzugefügt werden)
- **Alle löschen**: Klicke "Alle löschen" Button

## 🔧 Konfiguration

### Lighter API-Endpunkt ändern

In `worker/src/index.ts`:

```typescript
const ws = new WebSocket('wss://api.lighter.xyz/v1/ws');
```

### Alert-Limit anpassen

Standard: 100 letzte Alarme. Ändern in `worker/src/index.ts`:

```typescript
async sendAlertHistory(websocket: WebSocket, limit: number = 200) {
  // Limit angepasst
}
```

### Browser-Notifications

Werden automatisch beim ersten Laden angefragt. Falls verpasst:

```javascript
// In Browser-Console
Notification.requestPermission();
```

## 📊 Database-Verwaltung

### Alarme abfragen

```bash
# Alle Alarme
wrangler d1 execute lighter-alerts --command "SELECT * FROM alerts ORDER BY timestamp DESC LIMIT 10"

# Alarme für bestimmtes Token
wrangler d1 execute lighter-alerts --command "SELECT * FROM alerts WHERE token_id = 'WETH_USDC' ORDER BY timestamp DESC"

# Anzahl Alarme pro Token
wrangler d1 execute lighter-alerts --command "SELECT token_id, COUNT(*) as count FROM alerts GROUP BY token_id"
```

### Alte Alarme löschen

```bash
# Alarme älter als 30 Tage
wrangler d1 execute lighter-alerts --command "DELETE FROM alerts WHERE timestamp < strftime('%s', 'now', '-30 days') * 1000"
```

### Database-Backup

```bash
# Backup erstellen
wrangler d1 backup create lighter-alerts

# Backups listen
wrangler d1 backup list lighter-alerts

# Backup wiederherstellen
wrangler d1 backup restore lighter-alerts <backup-id>
```

## 🛠️ Entwicklung

### Lokale Entwicklung

```bash
# Worker lokal starten
cd worker
npm run dev
# Läuft auf http://localhost:8787

# Frontend anpassen
cd ../frontend
# Öffne index.html und setze:
# const WS_URL = 'ws://localhost:8787/ws';

# Frontend lokal hosten
npx serve .
```

### Logs ansehen

```bash
# Live Worker-Logs
npm run tail

# Mit Filtering
wrangler tail --format=pretty --status=error
```

### Database lokal testen

```bash
# Lokale D1 Database verwenden
npm run db:local-init

# Worker mit lokaler DB starten
npm run dev
```

## 📈 Performance & Kosten

### Performance
- **WebSocket-Latenz**: < 100ms
- **Database-Queries**: < 10ms (D1)
- **Alert-Speicherung**: < 5ms
- **Max. Alerts**: Unbegrenzt (D1 skaliert automatisch)

### Kosten (Cloudflare)

**Free Tier beinhaltet:**
- ✅ 100.000 Worker Requests/Tag
- ✅ 5 GB D1 Storage
- ✅ 5 Million D1 Rows gelesen/Tag
- ✅ 100.000 D1 Rows geschrieben/Tag

**Geschätzte Kosten für 24/7 Monitoring:**

| Komponente | Free Tier | Nach Free Tier |
|------------|-----------|----------------|
| Worker Requests | 100k/Tag | $0.50 pro 1M |
| D1 Storage (1 Jahr Alerts) | ~50 MB | Im Free Tier |
| D1 Reads | ~500k/Tag | Im Free Tier |
| D1 Writes | ~1k/Tag | Im Free Tier |
| **Total** | **$0/Monat** | **~$5-10/Monat** |

## 🔐 Sicherheit

- ✅ WebSocket verschlüsselt (WSS)
- ✅ CORS konfiguriert
- ✅ Input-Validierung
- ✅ Database-Prepared Statements (SQL-Injection-Schutz)
- ✅ Rate-Limiting über Cloudflare
- ✅ Keine API-Keys im Frontend

## 🆚 v1 vs v2 Vergleich

| Feature | v1 | v2 |
|---------|----|----|
| Monitoring | Nur während Website offen | ✅ **24/7 im Hintergrund** |
| Alerts | Nur im Browser | ✅ **Persistent in Database** |
| Historie | Verloren beim Schließen | ✅ **Dauerhaft gespeichert** |
| Notifications | ❌ | ✅ **Browser-Notifications** |
| Statistiken | Basis | ✅ **Erweitert mit Totals** |
| Database | ❌ | ✅ **D1 SQLite** |

## 🐛 Troubleshooting

### Database-Fehler beim Deploy

```bash
# Prüfe ob Database existiert
wrangler d1 list

# Erstelle Database falls nötig
npm run db:create

# Initialisiere Schema
npm run db:init
```

### Keine Alerts werden gespeichert

```bash
# Prüfe Database-Binding in wrangler.toml
# Stelle sicher, dass database_id korrekt ist

# Teste Database-Verbindung
wrangler d1 execute lighter-alerts --command "SELECT COUNT(*) FROM alerts"
```

### WebSocket verbindet nicht

1. Prüfe Worker-URL in Frontend
2. Prüfe ob Worker deployed ist: `wrangler deployments list`
3. Teste Worker direkt: `curl https://YOUR-WORKER.workers.dev/`

## 📚 API-Dokumentation

### WebSocket Messages

#### Client → Worker

**Monitor hinzufügen:**
```json
{
  "type": "add_monitor",
  "tokenId": "WETH_USDC",
  "threshold": 3500.0,
  "monitorType": "below"
}
```

**Alerts abrufen:**
```json
{
  "type": "get_alerts",
  "limit": 100
}
```

**Alle Alerts löschen:**
```json
{
  "type": "clear_alerts"
}
```

#### Worker → Client

**Preis-Alarm (NEU!):**
```json
{
  "type": "price_alert",
  "data": {
    "id": "WETH_USDC_1702661234567",
    "tokenId": "WETH_USDC",
    "currentPrice": 3480.50,
    "threshold": 3500.0,
    "type": "below",
    "timestamp": 1702661234567,
    "triggered": true
  }
}
```

**Alert-Historie (NEU!):**
```json
{
  "type": "alert_history",
  "data": [
    {
      "id": "...",
      "token_id": "WETH_USDC",
      "current_price": 3480.50,
      "threshold": 3500.0,
      "type": "below",
      "timestamp": 1702661234567,
      "triggered": 1
    }
  ]
}
```

### HTTP Endpoints

**Alert-Historie per HTTP abrufen:**
```bash
curl https://YOUR-WORKER.workers.dev/api/alerts?limit=50
```

Response:
```json
[
  {
    "id": "WETH_USDC_1702661234567",
    "token_id": "WETH_USDC",
    "current_price": 3480.50,
    "threshold": 3500.0,
    "type": "below",
    "timestamp": 1702661234567
  }
]
```

## 🤝 Contributing

Pull Requests willkommen!

1. Fork das Repository
2. Feature-Branch erstellen
3. Änderungen committen
4. Push zum Branch
5. Pull Request öffnen

## 📝 Changelog

### v2.0.0 (2024-12-15)
- ✨ **NEU:** Persistentes Hintergrund-Monitoring
- ✨ **NEU:** D1 Database für Alert-Historie
- ✨ **NEU:** Browser-Notifications
- ✨ **NEU:** Erweiterte Statistiken
- ✨ **NEU:** HTTP API für Alert-Abfrage
- 🔧 Verbesserte Error-Handling
- 🎨 Überarbeitete UI

### v1.0.0 (2024-12-15)
- 🎉 Initial Release
- ✅ Echtzeit-WebSocket-Verbindung
- ✅ Konfigurierbare Monitore
- ✅ React-UI

## 📄 Lizenz

MIT License - siehe [LICENSE](LICENSE)

## 🙏 Danksagungen

- [Lighter DEX](https://lighter.xyz/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)

---

**⭐ Wenn dir dieses Projekt gefällt, gib ihm einen Stern auf GitHub!**

Made with ❤️ and ☕ - Persistent Monitoring für alle!
