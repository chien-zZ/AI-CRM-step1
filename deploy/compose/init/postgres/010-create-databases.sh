#!/bin/sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
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

psql --username "$POSTGRES_USER" --dbname ai_crm <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE ai_crm TO ai_crm_runtime;
GRANT CONNECT ON DATABASE ai_crm TO ai_crm_worker_runtime;
SQL
