#!/bin/sh
set -e

echo "Running data migrations..."
node scripts/migrate-epic-assignments.js

echo "Applying database schema..."
npx prisma db push --skip-generate

echo "Starting backend..."
exec node dist/main.js
