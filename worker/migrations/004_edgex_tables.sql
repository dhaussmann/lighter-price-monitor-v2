-- edgeX Markets Table
CREATE TABLE IF NOT EXISTS edgex_markets (
  contract_id TEXT PRIMARY KEY,
  contract_name TEXT NOT NULL,
  last_updated INTEGER NOT NULL
);

-- Note: EdgeX uses the standard orderbook_snapshots and orderbook_minutes tables
-- with source='edgex' to differentiate from other exchanges
