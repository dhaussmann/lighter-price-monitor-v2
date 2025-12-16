-- ============================================
-- CLEAN DATABASE SCHEMA - Lighter Orderbook Tracker
-- ============================================

-- Market-Symbol Mapping (von Lighter API)
CREATE TABLE IF NOT EXISTS lighter_markets (
  market_index INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  active INTEGER DEFAULT 1,
  last_updated INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_lighter_markets_symbol ON lighter_markets(symbol);

-- 15-Sekunden Snapshots (für aktuelle Minute, wird nach Aggregation gelöscht)
CREATE TABLE IF NOT EXISTS lighter_snapshots (
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

CREATE INDEX IF NOT EXISTS idx_lighter_snapshots_timestamp ON lighter_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_lighter_snapshots_symbol ON lighter_snapshots(symbol, timestamp);

-- Minuten-Aggregation (1 Stunde Retention)
CREATE TABLE IF NOT EXISTS lighter_minutes (
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

CREATE INDEX IF NOT EXISTS idx_lighter_minutes_timestamp ON lighter_minutes(timestamp);
CREATE INDEX IF NOT EXISTS idx_lighter_minutes_symbol ON lighter_minutes(symbol, timestamp);

-- Tracking Stats (für Frontend)
CREATE TABLE IF NOT EXISTS tracking_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stat_key TEXT NOT NULL UNIQUE,
  stat_value TEXT,
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);
