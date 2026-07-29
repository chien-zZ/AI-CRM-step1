#!/bin/sh
set -eu

for secret in postgres_flowable_password flowable_admin_password; do
  if [ ! -r "/run/secrets/$secret" ] || [ ! -s "/run/secrets/$secret" ]; then
    echo "Flowable required Secret file is unavailable." >&2
    exit 1
  fi
  value="$(cat "/run/secrets/$secret")"
  if [ "${#value}" -ne 43 ]; then echo "Flowable Secret has an invalid format." >&2; exit 1; fi
  case "$value" in ''|*[!A-Za-z0-9_-]*) echo "Flowable Secret has an invalid format." >&2; exit 1 ;; esac
done

export SPRING_DATASOURCE_PASSWORD="$(cat /run/secrets/postgres_flowable_password)"
export FLOWABLE_REST_APP_ADMIN_PASSWORD="$(cat /run/secrets/flowable_admin_password)"
exec /flowable-entrypoint.sh "$@"
