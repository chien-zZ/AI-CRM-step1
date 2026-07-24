#!/bin/sh
set -eu

export SPRING_DATASOURCE_PASSWORD="$(cat /run/secrets/postgres_flowable_password)"
export FLOWABLE_REST_APP_ADMIN_PASSWORD="$(cat /run/secrets/flowable_admin_password)"
exec /flowable-entrypoint.sh "$@"
