#!/bin/sh
set -eu

if [ ! -r /run/secrets/rabbitmq_password ]; then
  echo "RabbitMQ Secret file is unavailable." >&2
  exit 1
fi
umask 077
password="$(cat /run/secrets/rabbitmq_password)"
if [ "${#password}" -ne 43 ]; then
  echo "RabbitMQ Secret has an invalid format." >&2
  exit 1
fi
case "$password" in ''|*[!A-Za-z0-9_-]*) echo "RabbitMQ Secret has an invalid format." >&2; exit 1 ;; esac
printf 'default_user = ai_crm_messaging\ndefault_pass = %s\n' "$password" >/tmp/rabbitmq.conf
export RABBITMQ_CONFIG_FILE=/tmp/rabbitmq
exec rabbitmq-server
