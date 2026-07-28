CREATE SCHEMA authorization_core;

CREATE TABLE authorization_core.policy_versions (
  version varchar(128) PRIMARY KEY,
  contract_version varchar(64) NOT NULL,
  content_digest char(64) NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (version, content_digest)
);

CREATE TABLE authorization_core.policy_publications (
  publication_id uuid PRIMARY KEY,
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  policy_version varchar(128) NOT NULL,
  content_digest char(64) NOT NULL,
  published_at timestamptz NOT NULL,
  previous_policy_version varchar(128),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  FOREIGN KEY (policy_version, content_digest)
    REFERENCES authorization_core.policy_versions(version, content_digest),
  FOREIGN KEY (previous_policy_version)
    REFERENCES authorization_core.policy_versions(version),
  UNIQUE (publication_id, policy_version, content_digest)
);

CREATE TABLE authorization_core.current_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version varchar(128) NOT NULL,
  content_digest char(64) NOT NULL,
  publication_id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (publication_id, version, content_digest)
    REFERENCES authorization_core.policy_publications(publication_id, policy_version, content_digest)
);

CREATE TABLE authorization_core.decision_records (
  decision_id uuid PRIMARY KEY,
  record_digest char(64) NOT NULL CHECK (record_digest ~ '^[0-9a-f]{64}$'),
  evaluated_at timestamptz NOT NULL,
  operation varchar(32) NOT NULL CHECK (operation IN ('batch_check', 'check', 'resolve_data_scope')),
  resource varchar(128) NOT NULL,
  action varchar(64) NOT NULL,
  permission_code varchar(193) NOT NULL,
  allowed boolean NOT NULL,
  reason varchar(32) NOT NULL CHECK (reason IN ('allowed', 'unknown_permission', 'no_applicable_grant', 'invalid_context', 'resource_context_required', 'scope_mismatch', 'policy_unavailable', 'policy_invalid')),
  policy_version varchar(128) NOT NULL,
  workforce_person_id uuid,
  selected_assignment_id uuid,
  trace_id char(32) NOT NULL CHECK (trace_id ~ '^[0-9a-f]{32}$')
);

CREATE FUNCTION authorization_core.reject_immutable_fact_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'authorization immutable facts cannot be updated or deleted' USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER authorization_policy_versions_immutable
BEFORE UPDATE OR DELETE ON authorization_core.policy_versions
FOR EACH ROW EXECUTE FUNCTION authorization_core.reject_immutable_fact_mutation();

CREATE TRIGGER authorization_policy_publications_immutable
BEFORE UPDATE OR DELETE ON authorization_core.policy_publications
FOR EACH ROW EXECUTE FUNCTION authorization_core.reject_immutable_fact_mutation();

CREATE TRIGGER authorization_decision_records_immutable
BEFORE UPDATE OR DELETE ON authorization_core.decision_records
FOR EACH ROW EXECUTE FUNCTION authorization_core.reject_immutable_fact_mutation();

COMMENT ON SCHEMA authorization_core IS 'AUTH-PERSIST-01 owner schema. Contains no seeded policy, role, permission, or grant.';
COMMENT ON TABLE authorization_core.current_policy IS 'Mutable singleton pointer; only the reviewed transactional publication use case may change it.';
