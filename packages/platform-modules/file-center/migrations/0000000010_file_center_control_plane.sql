CREATE SCHEMA file_center;
CREATE TABLE file_center.files(
  file_id uuid PRIMARY KEY,
  owner_module varchar(128) NOT NULL,
  display_name varchar(255) NOT NULL,
  classification_reference varchar(128),
  uploaded_by jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE file_center.content_versions(
  content_version_id uuid PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES file_center.files(file_id),
  version_number integer NOT NULL CHECK(version_number>0),
  object_handle varchar(255) NOT NULL UNIQUE,
  declared_media_type varchar(255) NOT NULL,
  declared_size_bytes bigint NOT NULL CHECK(declared_size_bytes>0),
  actual_size_bytes bigint CHECK(actual_size_bytes>0),
  detected_media_type varchar(255),
  checksum_sha256 varchar(64) CHECK(checksum_sha256 IS NULL OR checksum_sha256~'^[a-f0-9]{64}$'),
  status varchar(32) NOT NULL CHECK(status IN('awaiting_upload','pending_scan','available','quarantine_pending','quarantined','object_missing','cleanup_pending','deleted')),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  scanned_at timestamptz,
  scanner_version varchar(128),
  UNIQUE(file_id,version_number),
  UNIQUE(content_version_id,file_id)
);
CREATE TABLE file_center.upload_sessions(
  session_id uuid PRIMARY KEY,
  file_id uuid NOT NULL,
  content_version_id uuid NOT NULL,
  status varchar(32) NOT NULL CHECK(status IN('created','pending_scan','expired','cleanup_pending','cleaned')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK(created_at<expires_at),
  completed_at timestamptz,
  FOREIGN KEY(content_version_id,file_id) REFERENCES file_center.content_versions(content_version_id,file_id)
);
CREATE TABLE file_center.resource_links(
  link_id uuid PRIMARY KEY,
  file_id uuid NOT NULL,
  content_version_id uuid NOT NULL,
  owner_module varchar(128) NOT NULL,
  resource_type varchar(128) NOT NULL,
  resource_id varchar(255) NOT NULL,
  relation_type varchar(128) NOT NULL,
  linked_at timestamptz NOT NULL,
  unlinked_at timestamptz,
  FOREIGN KEY(content_version_id,file_id) REFERENCES file_center.content_versions(content_version_id,file_id),
  CHECK(unlinked_at IS NULL OR linked_at<=unlinked_at)
);
CREATE INDEX file_center_active_resource_link_lookup ON file_center.resource_links(resource_type,resource_id,unlinked_at);
CREATE TABLE file_center.operation_receipts(operation_id uuid PRIMARY KEY,fingerprint varchar(64) NOT NULL CHECK(length(fingerprint)=64),result jsonb NOT NULL);
CREATE TABLE file_center.outbox_events(event_id uuid PRIMARY KEY,event_type varchar(80) NOT NULL,resource_id uuid NOT NULL,occurred_at timestamptz NOT NULL,payload jsonb NOT NULL,published_at timestamptz,last_error text);
CREATE FUNCTION file_center.guard_file_metadata() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'file metadata is immutable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER file_metadata_no_update_delete BEFORE UPDATE OR DELETE ON file_center.files FOR EACH ROW EXECUTE FUNCTION file_center.guard_file_metadata();
CREATE FUNCTION file_center.guard_content_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'content versions cannot be deleted' USING ERRCODE='55000'; END IF; IF NEW.content_version_id<>OLD.content_version_id OR NEW.file_id<>OLD.file_id OR NEW.version_number<>OLD.version_number OR NEW.object_handle<>OLD.object_handle OR NEW.declared_media_type<>OLD.declared_media_type OR NEW.declared_size_bytes<>OLD.declared_size_bytes OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'immutable content version fields cannot change' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
CREATE TRIGGER content_version_guard BEFORE UPDATE OR DELETE ON file_center.content_versions FOR EACH ROW EXECUTE FUNCTION file_center.guard_content_version();
CREATE FUNCTION file_center.guard_resource_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'resource links cannot be deleted' USING ERRCODE='55000'; END IF; IF NEW.link_id<>OLD.link_id OR NEW.file_id<>OLD.file_id OR NEW.content_version_id<>OLD.content_version_id OR NEW.owner_module<>OLD.owner_module OR NEW.resource_type<>OLD.resource_type OR NEW.resource_id<>OLD.resource_id OR NEW.relation_type<>OLD.relation_type OR NEW.linked_at<>OLD.linked_at OR OLD.unlinked_at IS NOT NULL OR NEW.unlinked_at IS NULL THEN RAISE EXCEPTION 'resource link history is immutable' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
CREATE TRIGGER resource_link_guard BEFORE UPDATE OR DELETE ON file_center.resource_links FOR EACH ROW EXECUTE FUNCTION file_center.guard_resource_link();
COMMENT ON SCHEMA file_center IS 'PLT-03 owner schema. Roll forward only after deployment; before first deployment this reserved migration may be review-corrected. Binary content and provider credentials are forbidden.';
