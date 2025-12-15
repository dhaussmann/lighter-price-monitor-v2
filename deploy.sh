#!/bin/bash

# Lighter Price Monitor v2 - Deployment Script
# Mit D1 Database Setup für persistente Alert-Speicherung

set -e

echo "🚀 Lighter Price Monitor v2 - Deployment"
echo "========================================="
echo ""

# Prüfe ob wrangler installiert ist
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI nicht gefunden!"
    echo "Installiere mit: npm install -g wrangler"
    exit 1
fi

echo "✅ Wrangler CLI gefunden"
echo ""

# Navigiere zum Worker-Verzeichnis
cd worker

echo "📦 Installiere Dependencies..."
npm install
echo ""

# Prüfe ob D1 Database existiert
echo "🗄️  Prüfe D1 Database..."
DB_EXISTS=$(wrangler d1 list 2>/dev/null | grep -c "lighter-alerts" || true)

if [ "$DB_EXISTS" -eq "0" ]; then
    echo "📝 Erstelle D1 Database 'lighter-alerts'..."
    wrangler d1 create lighter-alerts
    
    echo ""
    echo "⚠️  WICHTIG: Kopiere die Database-ID aus dem Output oben!"
    echo "   Öffne wrangler.toml und ersetze YOUR_DATABASE_ID"
    echo ""
    read -p "Drücke ENTER wenn du die Database-ID in wrangler.toml eingetragen hast..."
else
    echo "✅ D1 Database 'lighter-alerts' existiert bereits"
fi

echo ""
echo "🏗️  Initialisiere Database-Schema..."
npm run db:init

echo ""
echo "🚀 Deploye Worker zu Cloudflare..."
wrangler deploy

echo ""
echo "✅ Worker erfolgreich deployed!"
echo ""

# Hole die Worker-URL
WORKER_URL=$(wrangler deployments list --json 2>/dev/null | grep -o '"url":"[^"]*"' | head -1 | sed 's/"url":"//;s/"//')

if [ -z "$WORKER_URL" ]; then
    echo "⚠️  Konnte Worker-URL nicht automatisch ermitteln."
    echo "   Führe 'wrangler deployments list' aus, um die URL zu sehen."
else
    echo "📍 Worker-URL: $WORKER_URL"
    WS_URL="wss://${WORKER_URL#https://}/ws"
    echo "📍 WebSocket-URL: $WS_URL"
fi

echo ""
echo "📋 Nächste Schritte:"
echo ""
echo "1. ✅ Database ist initialisiert und bereit"
echo "2. ✅ Worker ist deployed"
echo ""
echo "3. 📝 Konfiguriere das Frontend:"
echo "   - Öffne: frontend/index.html"
echo "   - Suche nach: 'const WS_URL'"
echo "   - Ersetze mit: $WS_URL"
echo ""
echo "4. 🚀 Deploye das Frontend:"
echo "   cd ../frontend"
echo "   npx wrangler pages deploy . --project-name=lighter-monitor-v2"
echo ""
echo "5. 🎉 Fertig! Teste dein Monitoring:"
echo "   - Öffne die Frontend-URL"
echo "   - Füge einen Monitor hinzu"
echo "   - Schließe die Website"
echo "   - Monitoring läuft weiter im Hintergrund!"
echo ""
echo "📊 Database-Management:"
echo "   - Alerts ansehen: npm run db:query 'SELECT * FROM alerts LIMIT 10'"
echo "   - Alle Alerts: wrangler d1 execute lighter-alerts --command 'SELECT COUNT(*) FROM alerts'"
echo ""
echo "✨ Viel Erfolg mit persistentem Monitoring!"
