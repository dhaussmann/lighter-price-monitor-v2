#!/bin/bash
# Reset Database Script
# Deletes all data from the database while keeping the schema

echo "🗑️  Resetting database..."
echo "This will delete ALL data from:"
echo "  - orderbook_entries"
echo "  - paradex_trades"
echo "  - token_mapping"
echo ""
read -p "Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "❌ Cancelled"
  exit 1
fi

echo ""
echo "🔄 Executing SQL commands..."

wrangler d1 execute DB --remote --file=reset-database.sql

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Database reset complete!"
  echo "All data has been deleted."
else
  echo ""
  echo "❌ Error resetting database"
  exit 1
fi
