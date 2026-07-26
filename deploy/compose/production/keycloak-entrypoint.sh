#!/bin/sh
set -eu

if [ ! -r /run/secrets/postgres_keycloak_password ]; then
  echo "Keycloak database Secret file is unavailable." >&2
  exit 1
fi

export KC_DB_PASSWORD="$(cat /run/secrets/postgres_keycloak_password)"
exec /opt/keycloak/bin/kc.sh "$@"
