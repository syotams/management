#!/bin/sh
set -e

echo "Applying database schema..."
npx prisma db push --skip-generate

echo "Starting backend..."
exec node dist/main.js
