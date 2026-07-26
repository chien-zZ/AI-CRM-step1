CREATE SCHEMA audit;

CREATE TABLE audit.records (
  audit_id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  action varchar(128) NOT NULL,
  actor_id varchar(255) NOT NULL,
  actor_type varchar(32) NOT NULL,
  workforce_person_id uuid,
  assignment_id uuid,
  resource_type varchar(128) NOT NULL,
  resource_id varchar(255) NOT NULL,
  result varchar(16) NOT NULL,
  reason_code varchar(128) NOT NULL,
  reason_detail varchar(500),
  trace_id varchar(32) NOT NULL,
  authorization_decision_id uuid,
  operation_id uuid NOT NULL,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT audit_records_actor_type_check CHECK (actor_type IN ('authenticated_subject', 'system')),
  CONSTRAINT audit_records_result_check CHECK (result IN ('attempted', 'succeeded', 'failed', 'denied')),
  CONSTRAINT audit_records_trace_id_check CHECK (trace_id ~ '^(?!0{32})[0-9a-f]{32}$'),
  CONSTRAINT audit_records_changes_array_check CHECK (jsonb_typeof(changes) = 'array')
);
CREATE INDEX audit_records_resource_time_idx ON audit.records (resource_type, resource_id, occurred_at);
CREATE INDEX audit_records_actor_time_idx ON audit.records (actor_id, occurred_at);

CREATE TABLE audit.operation_receipts (
  operation_id uuid PRIMARY KEY,
  audit_id uuid NOT NULL REFERENCES audit.records(audit_id),
  fingerprint varchar(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT audit_receipts_fingerprint_length CHECK (length(fingerprint) = 64)
);

CREATE FUNCTION audit.reject_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit records are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_records_append_only
BEFORE UPDATE OR DELETE ON audit.records
FOR EACH ROW EXECUTE FUNCTION audit.reject_record_mutation();

CREATE TRIGGER audit_receipts_append_only
BEFORE UPDATE OR DELETE ON audit.operation_receipts
FOR EACH ROW EXECUTE FUNCTION audit.reject_record_mutation();

REVOKE UPDATE, DELETE ON audit.records FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit.operation_receipts FROM PUBLIC;
