-- Lighter Price Monitor - D1 Database Schema
-- Speichert Alert-Historie persistent

-- Alerts Table
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  current_price REAL NOT NULL,
  threshold REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('above', 'below')),
  timestamp INTEGER NOT NULL,
  triggered INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index für schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_alerts_token_id ON alerts(token_id);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON alerts(triggered);

-- View für aktuellste Alerts pro Token
CREATE VIEW IF NOT EXISTS latest_alerts AS
SELECT 
  a.*,
  ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY timestamp DESC) as rn
FROM alerts a
WHERE triggered = 1;
