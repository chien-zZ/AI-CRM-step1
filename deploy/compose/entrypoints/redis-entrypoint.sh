#!/bin/sh
set -eu

password=$(cat /run/secrets/redis_password)
umask 077
printf 'appendonly yes\nrequirepass %s\n' "$password" >/tmp/redis.conf
chown redis:redis /tmp/redis.conf
exec docker-entrypoint.sh redis-server /tmp/redis.conf
