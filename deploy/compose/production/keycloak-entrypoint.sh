#!/bin/sh
set -eu

if [ ! -r /run/secrets/postgres_keycloak_password ] || [ ! -s /run/secrets/postgres_keycloak_password ]; then
  echo "Keycloak database Secret file is unavailable." >&2
  exit 1
fi

database_password="$(cat /run/secrets/postgres_keycloak_password)"
if [ "${#database_password}" -ne 43 ]; then echo "Keycloak database Secret has an invalid format." >&2; exit 1; fi
case "$database_password" in ''|*[!A-Za-z0-9_-]*) echo "Keycloak database Secret has an invalid format." >&2; exit 1 ;; esac
export KC_DB_PASSWORD="$database_password"
exec /opt/keycloak/bin/kc.sh "$@"
