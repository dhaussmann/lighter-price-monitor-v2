-- Migration: Drop old tables and create new schema
-- WARNING: This will delete all existing data!

-- Drop old tables
DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS orderbook_entries;
DROP TABLE IF EXISTS paradex_trades;
DROP TABLE IF EXISTS token_mapping;

-- Now run schema.sql to create new tables
