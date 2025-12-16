-- ============================================
-- PARADEX ORDERBOOK TRACKER - Database Schema
-- ============================================

-- Market Mapping (von Paradex API)
CREATE TABLE IF NOT EXISTS paradex_markets (
  symbol TEXT PRIMARY KEY,
  market_type TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  last_updated INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_paradex_markets_base ON paradex_markets(base_asset);

-- 15-Sekunden Snapshots (temporär, wird nach Aggregation gelöscht)
CREATE TABLE IF NOT EXISTS paradex_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

CREATE INDEX IF NOT EXISTS idx_paradex_snapshots_timestamp ON paradex_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_paradex_snapshots_symbol ON paradex_snapshots(symbol, timestamp);

-- Minuten-Aggregation (1 Stunde Retention)
CREATE TABLE IF NOT EXISTS paradex_minutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  UNIQUE(symbol, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_paradex_minutes_timestamp ON paradex_minutes(timestamp);
CREATE INDEX IF NOT EXISTS idx_paradex_minutes_symbol ON paradex_minutes(symbol, timestamp);
