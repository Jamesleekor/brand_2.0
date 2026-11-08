#!/usr/bin/env bash
# 로컬 PostgreSQL 16에서 퀴즈 로얄 시험 실행 (운영 DB와 무관)
# 사용: PGHOST=/tmp/pgq PGPORT=55432 bash supabase/tests/quiz_royal/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
P="psql -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists quiz_royal_test" -c "create database quiz_royal_test"
$P -d quiz_royal_test -f supabase/tests/quiz_royal/00_scaffold.sql 2>&1 | grep -v -e wal_level -e 'HINT' || true
$P -d quiz_royal_test -f supabase/migrations/20261107_01_quiz_royal.sql 2>&1 | grep -v NOTICE || true
$P -d quiz_royal_test -f supabase/migrations/20261107_01_quiz_royal.sql >/dev/null 2>&1   # 두 번 적용해도 안전한지
$P -d quiz_royal_test -f supabase/tests/quiz_royal/10_scenarios.sql
$P -d quiz_royal_test -f supabase/tests/quiz_royal/30_single_guild_rehearsal.sql
