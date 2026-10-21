#!/usr/bin/env bash
# Runs every migration twice on a throwaway local Postgres, then the SQL tests.
# Needs a local Postgres; set PGHOST/PGPORT/PGUSER if not the defaults.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="c50_test_$$"
export PGOPTIONS="--client-min-messages=warning"
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "create database $DB" >/dev/null
trap '$P -d postgres -c "drop database $DB" >/dev/null' EXIT
for run in 1 2; do
  $P -d "$DB" -f supabase/tests/auth_stub.sql $(ls supabase/migrations/*.sql | sort | sed 's/^/-f /')
done
$P -d "$DB" -f supabase/tests/phase1.sql | grep -E "PASSED"
