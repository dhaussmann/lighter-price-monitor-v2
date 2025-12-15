-- Initial Token Mapping Data
-- Fügt bekannte Token-Mappings für Lighter und Paradex hinzu

-- Lighter Mappings (Market IDs)
INSERT OR IGNORE INTO token_mapping (source, original_symbol, normalized_symbol, base_asset, quote_asset, market_type, active)
VALUES
  ('lighter', '0', 'ETH', 'ETH', 'USD', 'PERP', 1),
  ('lighter', '1', 'BTC', 'BTC', 'USD', 'PERP', 1);

-- Paradex Mappings (Market Symbols)
INSERT OR IGNORE INTO token_mapping (source, original_symbol, normalized_symbol, base_asset, quote_asset, market_type, active)
VALUES
  ('paradex', 'ETH-USD-PERP', 'ETH', 'ETH', 'USD', 'PERP', 1),
  ('paradex', 'BTC-USD-PERP', 'BTC', 'BTC', 'USD', 'PERP', 1),
  ('paradex', 'MNT-USD-PERP', 'MNT', 'MNT', 'USD', 'PERP', 1),
  ('paradex', 'SOL-USD-PERP', 'SOL', 'SOL', 'USD', 'PERP', 1),
  ('paradex', 'ARB-USD-PERP', 'ARB', 'ARB', 'USD', 'PERP', 1),
  ('paradex', 'DOGE-USD-PERP', 'DOGE', 'DOGE', 'USD', 'PERP', 1),
  ('paradex', 'AVAX-USD-PERP', 'AVAX', 'AVAX', 'USD', 'PERP', 1),
  ('paradex', 'OP-USD-PERP', 'OP', 'OP', 'USD', 'PERP', 1),
  ('paradex', 'MATIC-USD-PERP', 'MATIC', 'MATIC', 'USD', 'PERP', 1);

-- Hinweis: Diese Liste wird beim Startup automatisch um alle verfügbaren Markets erweitert
