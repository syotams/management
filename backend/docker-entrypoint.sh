#!/bin/sh
set -e

echo "Running data migrations..."
node scripts/migrate-epic-assignments.js

echo "Applying database schema..."
# Required in non-interactive Docker when dropping obsolete Epic copy columns/tables.
npx prisma db push --skip-generate --accept-data-loss

echo "Starting backend..."
exec node dist/main.js
