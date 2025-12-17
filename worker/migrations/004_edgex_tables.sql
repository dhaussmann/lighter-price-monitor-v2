-- edgeX Markets Table
CREATE TABLE IF NOT EXISTS edgex_markets (
  contract_id TEXT PRIMARY KEY,
  contract_name TEXT NOT NULL,
  last_updated INTEGER NOT NULL
);

-- edgeX Orderbook Snapshots (15-second aggregation)
CREATE TABLE IF NOT EXISTS edgex_orderbook_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL,
  contract_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  best_bid_price REAL,
  best_bid_size REAL,
  best_ask_price REAL,
  best_ask_size REAL,
  bid_depth_5 TEXT,
  ask_depth_5 TEXT,
  spread REAL,
  mid_price REAL
);

CREATE INDEX IF NOT EXISTS idx_edgex_snapshots_timestamp ON edgex_orderbook_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_edgex_snapshots_contract ON edgex_orderbook_snapshots(contract_id);

-- edgeX Orderbook Minutes (1-minute aggregation)
CREATE TABLE IF NOT EXISTS edgex_orderbook_minutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL,
  contract_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  avg_bid_price REAL,
  avg_ask_price REAL,
  avg_spread REAL,
  avg_mid_price REAL,
  min_bid_price REAL,
  max_bid_price REAL,
  min_ask_price REAL,
  max_ask_price REAL,
  snapshot_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_edgex_minutes_timestamp ON edgex_orderbook_minutes(timestamp);
CREATE INDEX IF NOT EXISTS idx_edgex_minutes_contract ON edgex_orderbook_minutes(contract_id);
