CREATE SCHEMA ai_crm_migrations;

CREATE TABLE ai_crm_migrations.applied_migrations (
  version varchar(10) PRIMARY KEY,
  name text NOT NULL,
  module_owner text NOT NULL,
  checksum varchar(64) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
