#!/bin/sh
set -eu

for secret in postgres_app_password postgres_worker_password postgres_migration_password postgres_keycloak_password postgres_flowable_password; do
  if [ ! -r "/run/secrets/$secret" ] || [ ! -s "/run/secrets/$secret" ]; then
    echo "PostgreSQL required Secret file is unavailable." >&2
    exit 1
  fi
  value="$(cat "/run/secrets/$secret")"
  if [ "${#value}" -ne 43 ]; then echo "PostgreSQL Secret has an invalid format." >&2; exit 1; fi
  case "$value" in ''|*[!A-Za-z0-9_-]*) echo "PostgreSQL Secret has an invalid format." >&2; exit 1 ;; esac
done

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\set app_password `cat /run/secrets/postgres_app_password`
\set worker_password `cat /run/secrets/postgres_worker_password`
\set migration_password `cat /run/secrets/postgres_migration_password`
\set keycloak_password `cat /run/secrets/postgres_keycloak_password`
\set flowable_password `cat /run/secrets/postgres_flowable_password`
CREATE ROLE ai_crm_migration LOGIN PASSWORD :'migration_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE ai_crm_runtime LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE ai_crm_worker_runtime LOGIN PASSWORD :'worker_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE ai_crm OWNER ai_crm_migration;
CREATE ROLE keycloak_runtime LOGIN PASSWORD :'keycloak_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE keycloak OWNER keycloak_runtime;
CREATE ROLE flowable_runtime LOGIN PASSWORD :'flowable_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE flowable OWNER flowable_runtime;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname ai_crm <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE ai_crm TO ai_crm_runtime;
GRANT CONNECT ON DATABASE ai_crm TO ai_crm_worker_runtime;
SQL
