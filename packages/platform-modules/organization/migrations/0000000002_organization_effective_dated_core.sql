CREATE SCHEMA organization;

CREATE TABLE organization.workforce_people (
  workforce_person_id uuid PRIMARY KEY,
  recorded_at timestamptz NOT NULL
);

CREATE TABLE organization.employments (
  employment_id uuid PRIMARY KEY,
  workforce_person_id uuid NOT NULL REFERENCES organization.workforce_people(workforce_person_id),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  CONSTRAINT employments_valid_interval CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT employments_id_person_unique UNIQUE (employment_id, workforce_person_id)
);
CREATE INDEX employments_person_time_idx
  ON organization.employments (workforce_person_id, effective_from, effective_to);

CREATE TABLE organization.organization_units (
  organization_unit_id uuid PRIMARY KEY,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  CONSTRAINT organization_units_valid_interval CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE organization.organization_unit_placements (
  placement_id uuid PRIMARY KEY,
  organization_unit_id uuid NOT NULL REFERENCES organization.organization_units(organization_unit_id),
  parent_organization_unit_id uuid REFERENCES organization.organization_units(organization_unit_id),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  CONSTRAINT organization_unit_placements_valid_interval CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT organization_unit_placements_not_self CHECK (parent_organization_unit_id IS NULL OR parent_organization_unit_id <> organization_unit_id)
);
CREATE INDEX organization_unit_placements_time_idx
  ON organization.organization_unit_placements (organization_unit_id, effective_from, effective_to);

CREATE TABLE organization.positions (
  position_id uuid PRIMARY KEY,
  organization_unit_id uuid NOT NULL REFERENCES organization.organization_units(organization_unit_id),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  CONSTRAINT positions_valid_interval CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT positions_id_unit_unique UNIQUE (position_id, organization_unit_id)
);

CREATE TABLE organization.assignments (
  assignment_id uuid PRIMARY KEY,
  workforce_person_id uuid NOT NULL REFERENCES organization.workforce_people(workforce_person_id),
  employment_id uuid NOT NULL,
  organization_unit_id uuid NOT NULL REFERENCES organization.organization_units(organization_unit_id),
  position_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  CONSTRAINT assignments_valid_interval CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT assignments_employment_person_fk FOREIGN KEY (employment_id, workforce_person_id)
    REFERENCES organization.employments(employment_id, workforce_person_id),
  CONSTRAINT assignments_position_unit_fk FOREIGN KEY (position_id, organization_unit_id)
    REFERENCES organization.positions(position_id, organization_unit_id)
);
CREATE INDEX assignments_person_time_idx
  ON organization.assignments (workforce_person_id, effective_from, effective_to);

CREATE TABLE organization.subject_associations (
  association_id uuid PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  workforce_person_id uuid NOT NULL REFERENCES organization.workforce_people(workforce_person_id),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  CONSTRAINT subject_associations_issuer_length CHECK (length(issuer) BETWEEN 1 AND 2048),
  CONSTRAINT subject_associations_subject_length CHECK (length(subject) BETWEEN 1 AND 255),
  CONSTRAINT subject_associations_valid_interval CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX subject_associations_subject_time_idx
  ON organization.subject_associations (issuer, subject, effective_from, effective_to);
CREATE INDEX subject_associations_person_time_idx
  ON organization.subject_associations (workforce_person_id, effective_from, effective_to);

CREATE TABLE organization.operation_receipts (
  operation_id uuid PRIMARY KEY,
  fingerprint varchar(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT operation_receipts_fingerprint_length CHECK (length(fingerprint) = 64)
);

CREATE FUNCTION organization.reject_overlapping_subject_association()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  subject_lock bigint := hashtextextended(NEW.issuer || E'\n' || NEW.subject, 0);
  person_lock bigint := hashtextextended(NEW.workforce_person_id::text, 0);
BEGIN
  PERFORM pg_advisory_xact_lock(LEAST(subject_lock, person_lock));
  PERFORM pg_advisory_xact_lock(GREATEST(subject_lock, person_lock));
  IF EXISTS (
    SELECT 1 FROM organization.subject_associations existing
    WHERE existing.association_id <> NEW.association_id
      AND (existing.workforce_person_id = NEW.workforce_person_id
        OR (existing.issuer = NEW.issuer AND existing.subject = NEW.subject))
      AND tstzrange(existing.effective_from, existing.effective_to, '[)')
        && tstzrange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'overlapping subject association' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subject_associations_no_overlap
BEFORE INSERT OR UPDATE OF issuer, subject, workforce_person_id, effective_from, effective_to
ON organization.subject_associations
FOR EACH ROW EXECUTE FUNCTION organization.reject_overlapping_subject_association();

CREATE FUNCTION organization.reject_overlapping_unit_placement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checkpoint timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('organization_hierarchy', 0));
  IF EXISTS (
    SELECT 1 FROM organization.organization_unit_placements existing
    WHERE existing.placement_id <> NEW.placement_id
      AND existing.organization_unit_id = NEW.organization_unit_id
      AND tstzrange(existing.effective_from, existing.effective_to, '[)')
        && tstzrange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'overlapping organization unit placement' USING ERRCODE = '23505';
  END IF;
  IF NEW.parent_organization_unit_id IS NOT NULL THEN
    FOR checkpoint IN
      SELECT NEW.effective_from
      UNION
      SELECT existing.effective_from
      FROM organization.organization_unit_placements existing
      WHERE existing.effective_from > NEW.effective_from
        AND (NEW.effective_to IS NULL OR existing.effective_from < NEW.effective_to)
    LOOP
      IF EXISTS (
        WITH RECURSIVE ancestors(organization_unit_id) AS (
          SELECT NEW.parent_organization_unit_id
          UNION
          SELECT placement.parent_organization_unit_id
          FROM ancestors
          JOIN organization.organization_unit_placements placement
            ON placement.organization_unit_id = ancestors.organization_unit_id
          WHERE placement.parent_organization_unit_id IS NOT NULL
            AND placement.effective_from <= checkpoint
            AND (placement.effective_to IS NULL OR placement.effective_to > checkpoint)
        )
        SELECT 1 FROM ancestors WHERE organization_unit_id = NEW.organization_unit_id
      ) THEN
        RAISE EXCEPTION 'organization hierarchy cycle' USING ERRCODE = 'P1001';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_unit_placements_no_overlap
BEFORE INSERT OR UPDATE OF organization_unit_id, effective_from, effective_to
ON organization.organization_unit_placements
FOR EACH ROW EXECUTE FUNCTION organization.reject_overlapping_unit_placement();
