#!/bin/sh
set -eu

for secret in postgres_keycloak_password keycloak_bootstrap_password pc_oidc_client_secret; do
  if [ ! -r "/run/secrets/$secret" ] || [ ! -s "/run/secrets/$secret" ]; then
    echo "Keycloak required Secret file is unavailable." >&2
    exit 1
  fi
  value="$(cat "/run/secrets/$secret")"
  if [ "${#value}" -ne 43 ]; then echo "Keycloak Secret has an invalid format." >&2; exit 1; fi
  case "$value" in ''|*[!A-Za-z0-9_-]*) echo "Keycloak Secret has an invalid format." >&2; exit 1 ;; esac
done

umask 077
export KC_DB_PASSWORD="$(cat /run/secrets/postgres_keycloak_password)"
export KC_BOOTSTRAP_ADMIN_PASSWORD="$(cat /run/secrets/keycloak_bootstrap_password)"

template=/opt/ai-crm/realm-dev.template.json
import_file=/opt/keycloak/data/import/realm-dev.json
if [ ! -r "$template" ]; then
  echo "Keycloak authentication Secret or Realm template is unavailable." >&2
  exit 1
fi
mkdir -p "$(dirname "$import_file")"

client_secret="$(cat /run/secrets/pc_oidc_client_secret)"
if [ "${#client_secret}" -ne 43 ]; then
  echo "Keycloak Client Secret has an invalid format." >&2
  exit 1
fi
case "$client_secret" in
  ''|*[!A-Za-z0-9_-]*)
    echo "Keycloak Client Secret has an invalid format." >&2
    exit 1
    ;;
esac

template_content="$(cat "$template")"
case "$template_content" in
  *__AI_CRM_PC_CLIENT_SECRET__*) ;;
  *)
    echo "Keycloak Realm template does not contain the Client Secret marker." >&2
    exit 1
    ;;
esac

import_content="${template_content//__AI_CRM_PC_CLIENT_SECRET__/$client_secret}"
printf '%s\n' "$import_content" > "$import_file"

# Realm import bootstraps an absent local/test Realm only. Existing Client Secrets are rotated through the Admin API.
exec /opt/keycloak/bin/kc.sh "$@"
