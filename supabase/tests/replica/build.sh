#!/bin/bash
# Rebuild an isolated replica DB: production-identical arcade/tikatuka schema +
# functions (see PHASE0 report) + GAME1/2 catalog + the new 20261030 migrations.
# usage: build.sh <dbname> [--no-migrations]
set -e
DB=${1:-starlink_e2e}
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../../migrations"
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54329} -U ${PGUSER:-postgres} -X -q -v ON_ERROR_STOP=1"
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
for f in 00_base.sql 01_tables_prod.sql 02_functions.sql 03_stubs_and_triggers.sql 04_acl_prod.sql 05_fixture_games.sql; do
  PGOPTIONS='-c search_path=public,extensions -c client_min_messages=warning' $P -d $DB -f "$HERE/$f" >/dev/null
done
if [ "$2" != "--no-migrations" ]; then
  for f in 20261030_10_starlink_04_deterministic_engine.sql 20261030_11_starlink_04_run_binding_and_submit.sql \
           20261030_12_starlink_04_preregistration_hidden.sql 20261030_13_arcade_period_force_finalize.sql; do
    PGOPTIONS='-c client_min_messages=warning' $P -d $DB -f "$MIG/$f" >/dev/null
  done
fi
echo "replica $DB ready"
