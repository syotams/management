#!/bin/sh

# stop also db
docker compose -f docker-compose.local.yml --env-file .env.local down -v
