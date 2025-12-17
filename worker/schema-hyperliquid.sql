-- Hyperliquid Market-Symbol Mapping
CREATE TABLE IF NOT EXISTS hyperliquid_markets (
  symbol TEXT PRIMARY KEY,
  active INTEGER DEFAULT 1,
  last_updated INTEGER DEFAULT (unixepoch() * 1000)
);

-- 15-Sekunden Snapshots (temporär)
CREATE TABLE IF NOT EXISTS hyperliquid_snapshots (
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

-- Minuten-Aggregation (1h Retention)
CREATE TABLE IF NOT EXISTS hyperliquid_minutes (
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

-- Indexes für Performance
CREATE INDEX IF NOT EXISTS idx_hyperliquid_snapshots_symbol_timestamp ON hyperliquid_snapshots(symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hyperliquid_minutes_symbol_timestamp ON hyperliquid_minutes(symbol, timestamp DESC);
