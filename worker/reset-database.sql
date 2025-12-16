-- Reset Database: Delete all data but keep schema
-- Execute with: wrangler d1 execute DB --remote --file=reset-database.sql

-- Delete all orderbook entries
DELETE FROM orderbook_entries;

-- Delete all paradex trades
DELETE FROM paradex_trades;

-- Delete all token mappings
DELETE FROM token_mapping;

-- Verify deletion (optional - comment out if not needed)
SELECT
  (SELECT COUNT(*) FROM orderbook_entries) as orderbook_count,
  (SELECT COUNT(*) FROM paradex_trades) as trades_count,
  (SELECT COUNT(*) FROM token_mapping) as mapping_count;
