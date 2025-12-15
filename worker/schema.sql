-- Lighter Price Monitor v2 - Database Schema
-- D1 SQLite Database für Alert-Historie

-- Alerts Tabelle - speichert alle Preis-Alarme persistent
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,                  -- Eindeutige ID (z.B. WETH_USDC_1702661234567)
  token_id TEXT NOT NULL,               -- Token-Paar (z.B. WETH_USDC)
  current_price REAL NOT NULL,          -- Aktueller Preis zum Zeitpunkt des Alarms
  threshold REAL NOT NULL,              -- Konfigurierter Schwellwert
  type TEXT NOT NULL,                   -- 'above' oder 'below'
  timestamp INTEGER NOT NULL,           -- Unix-Timestamp in Millisekunden
  triggered INTEGER DEFAULT 1           -- 1 = Alarm wurde ausgelöst
);

-- Index für schnelle Abfragen nach Token
CREATE INDEX IF NOT EXISTS idx_alerts_token_id
ON alerts(token_id);

-- Index für schnelle Abfragen nach Zeitstempel (neueste zuerst)
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp
ON alerts(timestamp DESC);

-- Index für kombinierte Abfragen (Token + Zeit)
CREATE INDEX IF NOT EXISTS idx_alerts_token_timestamp
ON alerts(token_id, timestamp DESC);
