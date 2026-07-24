#!/bin/sh
set -eu

password=$(cat /run/secrets/rabbitmq_password)
umask 077
printf 'default_user = ai_crm_messaging\ndefault_pass = %s\n' "$password" >/tmp/rabbitmq.conf
chown rabbitmq:rabbitmq /tmp/rabbitmq.conf
export RABBITMQ_CONFIG_FILE=/tmp/rabbitmq
exec docker-entrypoint.sh rabbitmq-server
