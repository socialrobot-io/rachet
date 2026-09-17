#!/bin/sh
# @@@SNIPSTART compose-postgres-setup
set -eu

: "${DB:=postgres12}"
: "${DB_PORT:=5432}"
: "${DBNAME:=temporal}"
: "${VISIBILITY_DBNAME:=temporal_visibility}"
: "${POSTGRES_SEEDS:?ERROR: POSTGRES_SEEDS environment variable is required}"
: "${POSTGRES_USER:?ERROR: POSTGRES_USER environment variable is required}"
: "${POSTGRES_PWD:?ERROR: POSTGRES_PWD environment variable is required}"

# temporal-sql-tool reads SQL_PASSWORD. Keep this explicit because the
# admin-tools image does not derive it from POSTGRES_PWD automatically.
export SQL_PASSWORD="${POSTGRES_PWD}"

SQL_ARGS="--plugin ${DB} --ep ${POSTGRES_SEEDS} -u ${POSTGRES_USER} -p ${DB_PORT}"

run_step() {
  step="$1"
  shift
  echo "Temporal schema: ${step}"
  if "$@"; then
    return 0
  else
    status=$?
    echo "ERROR: Temporal schema step '${step}' failed (exit ${status})." >&2
    echo "Check TEMPORAL_POSTGRES_PASSWORD against the password used when the temporal-db volume was first initialized." >&2
    return "${status}"
  fi
}

create_database_if_needed() {
  database="$1"
  output_file="$(mktemp)"

  if temporal-sql-tool ${SQL_ARGS} --db "${database}" create >"${output_file}" 2>&1; then
    rm -f "${output_file}"
    echo "Temporal schema: database ${database} created"
    return 0
  else
    status=$?
  fi
  if grep -Eiq 'already exists|duplicate_database' "${output_file}"; then
    rm -f "${output_file}"
    echo "Temporal schema: database ${database} already exists"
    return 0
  fi

  cat "${output_file}" >&2
  rm -f "${output_file}"
  echo "ERROR: Could not create or access PostgreSQL database ${database} (exit ${status})." >&2
  echo "If this is a redeploy, restore the original TEMPORAL_POSTGRES_PASSWORD for the existing temporal-db volume." >&2
  return "${status}"
}

echo 'Starting PostgreSQL schema setup...'
echo 'Waiting for PostgreSQL port to be available...'
nc -z -w 10 "${POSTGRES_SEEDS}" "${DB_PORT}"
echo 'PostgreSQL port is available'

create_database_if_needed "${DBNAME}"
run_step "${DBNAME} base schema" temporal-sql-tool ${SQL_ARGS} --db "${DBNAME}" setup-schema -v 0.0
run_step "${DBNAME} versioned schema" temporal-sql-tool ${SQL_ARGS} --db "${DBNAME}" update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned

create_database_if_needed "${VISIBILITY_DBNAME}"
run_step "${VISIBILITY_DBNAME} base schema" temporal-sql-tool ${SQL_ARGS} --db "${VISIBILITY_DBNAME}" setup-schema -v 0.0
run_step "${VISIBILITY_DBNAME} versioned schema" temporal-sql-tool ${SQL_ARGS} --db "${VISIBILITY_DBNAME}" update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned

echo 'PostgreSQL schema setup complete'
# @@@SNIPEND
