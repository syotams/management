#!/bin/sh
# Adapt the shared Prisma schema for MySQL (Docker/production only).
# Local development keeps provider = "sqlite" without @db.Text.
set -e

SCHEMA="${1:-prisma/schema.prisma}"

sed -i 's/provider = "sqlite"/provider = "mysql"/' "$SCHEMA"

# Long fields must be TEXT on MySQL (default VARCHAR(191) would truncate).
sed -i 's/description String?/description String?  @db.Text/' "$SCHEMA"
sed -i 's/body      String$/body      String   @db.Text/' "$SCHEMA"
sed -i 's/oldValue  String?/oldValue  String?  @db.Text/' "$SCHEMA"
sed -i 's/newValue  String?/newValue  String?  @db.Text/' "$SCHEMA"
sed -i 's/snapshot      String$/snapshot      String   @db.Text/' "$SCHEMA"

echo "Prepared MySQL schema at $SCHEMA"
