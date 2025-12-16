-- Migration 003: Aggregation Tables
-- Ersetzt einzelne orderbook_entries mit aggregierten Snapshots

-- 15-Sekunden Snapshots (nur für aktuelle Minute)
CREATE TABLE IF NOT EXISTS orderbook_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  avg_bid REAL,
  avg_ask REAL,
  avg_spread REAL,
  min_bid REAL,
  max_bid REAL,
  min_ask REAL,
  max_ask REAL,
  tick_count INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON orderbook_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_snapshots_symbol ON orderbook_snapshots(symbol);
CREATE INDEX IF NOT EXISTS idx_snapshots_source_symbol ON orderbook_snapshots(source, symbol, timestamp);

-- Minuten-Aggregation (für API queries, 1h Retention)
CREATE TABLE IF NOT EXISTS orderbook_minutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  avg_bid REAL,
  avg_ask REAL,
  avg_spread REAL,
  min_bid REAL,
  max_bid REAL,
  min_ask REAL,
  max_ask REAL,
  tick_count INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  UNIQUE(source, symbol, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_minutes_timestamp ON orderbook_minutes(timestamp);
CREATE INDEX IF NOT EXISTS idx_minutes_symbol ON orderbook_minutes(symbol);
CREATE INDEX IF NOT EXISTS idx_minutes_source_symbol ON orderbook_minutes(source, symbol, timestamp);

-- Optional: Alte orderbook_entries Tabelle kann später gedroppt werden
-- DROP TABLE IF EXISTS orderbook_entries;
