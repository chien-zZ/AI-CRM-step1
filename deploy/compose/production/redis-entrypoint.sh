#!/bin/sh
set -eu

if [ ! -r /run/secrets/redis_password ]; then
  echo "Redis Secret file is unavailable." >&2
  exit 1
fi
umask 077
password="$(cat /run/secrets/redis_password)"
if [ "${#password}" -ne 43 ]; then
  echo "Redis Secret has an invalid format." >&2
  exit 1
fi
case "$password" in ''|*[!A-Za-z0-9_-]*) echo "Redis Secret has an invalid format." >&2; exit 1 ;; esac
printf 'appendonly yes\nrequirepass %s\n' "$password" >/tmp/redis.conf
exec redis-server /tmp/redis.conf
