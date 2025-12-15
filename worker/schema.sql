-- Orderbook Data Tracker - Database Schema
-- D1 SQLite Database für Multi-Exchange Orderbook-Daten

-- Orderbook Entries - speichert Orderbook-Daten von mehreren Exchanges
CREATE TABLE IF NOT EXISTS orderbook_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                 -- 'lighter' oder 'paradex'
  market_id TEXT NOT NULL,              -- Original Market ID/Symbol von der Exchange
  normalized_symbol TEXT NOT NULL,      -- Normalisierter Token-Name (z.B. 'ETH', 'BTC')
  side TEXT NOT NULL,                   -- 'ask' oder 'bid' (BUY/SELL bei Paradex)
  price REAL NOT NULL,                  -- Preis des Eintrags
  size REAL NOT NULL,                   -- Größe/Volumen
  timestamp INTEGER NOT NULL,           -- Unix-Timestamp in Millisekunden
  seq_no INTEGER,                       -- Sequence number (Paradex)
  offset INTEGER,                       -- Orderbook offset (Lighter)
  nonce INTEGER                         -- Orderbook nonce (Lighter)
);

-- Indexes für orderbook_entries
CREATE INDEX IF NOT EXISTS idx_orderbook_source
ON orderbook_entries(source);

CREATE INDEX IF NOT EXISTS idx_orderbook_market_id
ON orderbook_entries(market_id);

CREATE INDEX IF NOT EXISTS idx_orderbook_normalized_symbol
ON orderbook_entries(normalized_symbol);

CREATE INDEX IF NOT EXISTS idx_orderbook_timestamp
ON orderbook_entries(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_orderbook_source_symbol_time
ON orderbook_entries(source, normalized_symbol, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_orderbook_side
ON orderbook_entries(market_id, side, timestamp DESC);

-- Paradex Trades - speichert alle Trades von Paradex (RPI und FILL)
CREATE TABLE IF NOT EXISTS paradex_trades (
  id TEXT PRIMARY KEY,                  -- Trade ID von Paradex
  market TEXT NOT NULL,                 -- Market Symbol (z.B. 'ETH-USD-PERP')
  normalized_symbol TEXT NOT NULL,      -- Normalisierter Token-Name (z.B. 'ETH')
  side TEXT NOT NULL,                   -- 'BUY' oder 'SELL'
  size REAL NOT NULL,                   -- Trade Größe
  price REAL NOT NULL,                  -- Trade Preis
  trade_type TEXT NOT NULL,             -- 'RPI' oder 'FILL'
  created_at INTEGER NOT NULL           -- Unix-Timestamp in Millisekunden
);

-- Indexes für paradex_trades
CREATE INDEX IF NOT EXISTS idx_trades_market
ON paradex_trades(market);

CREATE INDEX IF NOT EXISTS idx_trades_normalized_symbol
ON paradex_trades(normalized_symbol);

CREATE INDEX IF NOT EXISTS idx_trades_created_at
ON paradex_trades(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trades_type
ON paradex_trades(trade_type);

CREATE INDEX IF NOT EXISTS idx_trades_symbol_time
ON paradex_trades(normalized_symbol, created_at DESC);

-- Token Mapping - vereinheitlicht Token-Namen zwischen Exchanges
CREATE TABLE IF NOT EXISTS token_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                 -- 'lighter' oder 'paradex'
  original_symbol TEXT NOT NULL,        -- Original Symbol (z.B. '0' bei Lighter, 'ETH-USD-PERP' bei Paradex)
  normalized_symbol TEXT NOT NULL,      -- Normalisierter Name (z.B. 'ETH', 'BTC')
  base_asset TEXT,                      -- Base Asset (z.B. 'ETH')
  quote_asset TEXT,                     -- Quote Asset (z.B. 'USD', 'USDC')
  market_type TEXT,                     -- 'SPOT', 'PERP', etc.
  active INTEGER DEFAULT 1,             -- 1 = aktiv, 0 = inaktiv
  UNIQUE(source, original_symbol)
);

-- Index für token_mapping
CREATE INDEX IF NOT EXISTS idx_token_mapping_source_original
ON token_mapping(source, original_symbol);

CREATE INDEX IF NOT EXISTS idx_token_mapping_normalized
ON token_mapping(normalized_symbol);
