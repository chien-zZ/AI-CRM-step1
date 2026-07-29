#!/bin/sh
set -eu

for secret in rabbitmq_publisher_username rabbitmq_publisher_password rabbitmq_consumer_username rabbitmq_consumer_password rabbitmq_tls_certificate rabbitmq_tls_private_key rabbitmq_ca_certificate; do
  if [ ! -r "/run/secrets/$secret" ] || [ ! -s "/run/secrets/$secret" ]; then
    echo "RabbitMQ required Secret file is unavailable." >&2
    exit 1
  fi
done

publisher_username="$(cat /run/secrets/rabbitmq_publisher_username)"
publisher_password="$(cat /run/secrets/rabbitmq_publisher_password)"
consumer_username="$(cat /run/secrets/rabbitmq_consumer_username)"
consumer_password="$(cat /run/secrets/rabbitmq_consumer_password)"
vhost="${AI_CRM_RABBIT_VHOST:?RabbitMQ VHost is required}"

for username in "$publisher_username" "$consumer_username"; do
  case "$username" in ''|*[!A-Za-z0-9._@+-]*) echo "RabbitMQ username Secret has an invalid format." >&2; exit 1 ;; esac
done
for password in "$publisher_password" "$consumer_password"; do
  if [ "${#password}" -ne 43 ]; then echo "RabbitMQ password Secret has an invalid format." >&2; exit 1; fi
  case "$password" in ''|*[!A-Za-z0-9_-]*) echo "RabbitMQ password Secret has an invalid format." >&2; exit 1 ;; esac
done
case "$vhost" in ''|'/'|*[!A-Za-z0-9._-]*) echo "RabbitMQ VHost has an invalid format." >&2; exit 1 ;; esac

umask 077
cat >/tmp/rabbitmq.conf <<'EOF'
listeners.tcp = none
listeners.ssl.default = 5671
ssl_options.cacertfile = /run/secrets/rabbitmq_ca_certificate
ssl_options.certfile = /run/secrets/rabbitmq_tls_certificate
ssl_options.keyfile = /run/secrets/rabbitmq_tls_private_key
ssl_options.verify = verify_peer
ssl_options.fail_if_no_peer_cert = false
management.tcp.ip = 127.0.0.1
management.load_definitions = /tmp/rabbitmq-definitions.json
EOF

cat >/tmp/rabbitmq-definitions.json <<EOF
{"vhosts":[{"name":"$vhost"}],"users":[{"name":"$publisher_username","password":"$publisher_password","tags":[]},{"name":"$consumer_username","password":"$consumer_password","tags":[]}],"permissions":[{"user":"$publisher_username","vhost":"$vhost","configure":"^ai-crm\\.platform\\.events\\.v1$","write":"^ai-crm\\.platform\\.events\\.v1$","read":"^$"},{"user":"$consumer_username","vhost":"$vhost","configure":"^(ai-crm\\.platform\\.(events|retry|dead-letter)\\.v1|ai-crm\\.platform\\.task-center\\.projection(\\.retry\\.(30s|300s)|\\.dead)?\\.v1)$","write":"^(ai-crm\\.platform\\.(events|retry|dead-letter)\\.v1|ai-crm\\.platform\\.task-center\\.projection(\\.retry\\.(30s|300s)|\\.dead)?\\.v1)$","read":"^(ai-crm\\.platform\\.(events|retry|dead-letter)\\.v1|ai-crm\\.platform\\.task-center\\.projection\\.v1)$"}]}
EOF

export RABBITMQ_CONFIG_FILE=/tmp/rabbitmq
exec rabbitmq-server
