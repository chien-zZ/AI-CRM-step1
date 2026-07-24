#!/bin/sh
set -eu

export KC_DB_PASSWORD="$(cat /run/secrets/postgres_keycloak_password)"
export KC_BOOTSTRAP_ADMIN_PASSWORD="$(cat /run/secrets/keycloak_bootstrap_password)"
exec /opt/keycloak/bin/kc.sh "$@"
