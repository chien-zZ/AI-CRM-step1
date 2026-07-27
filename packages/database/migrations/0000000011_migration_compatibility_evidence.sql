ALTER TABLE ai_crm_migrations.applied_migrations
  ADD COLUMN application_compatibility_minimum_inclusive text,
  ADD COLUMN application_compatibility_maximum_exclusive text,
  ADD CONSTRAINT applied_migrations_compatibility_minimum_format
    CHECK (application_compatibility_minimum_inclusive IS NULL OR application_compatibility_minimum_inclusive ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  ADD CONSTRAINT applied_migrations_compatibility_maximum_format
    CHECK (application_compatibility_maximum_exclusive IS NULL OR application_compatibility_maximum_exclusive ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$');

UPDATE ai_crm_migrations.applied_migrations AS applied
SET application_compatibility_minimum_inclusive = evidence.minimum_inclusive
FROM (VALUES
  ('0000000001', 'aa37810959f341e35bcc14eef8f52161beb39dfc2a08a1fa5d5311746e187106', '0.0.0'),
  ('0000000002', 'b56c39b182576832e74b0a2661706836a060ae34a1a55afe6b516c6072ce96e5', '0.0.0'),
  ('0000000003', '3f8bd3eef550447ba954ab82194745f7a24f059979925a61be65f3d8ff196fc0', '0.0.0'),
  ('0000000004', 'fdcc02c6263b703d61b3b02a779cf86877afab44ca4c0288e34167176b504aa2', '0.0.0'),
  ('0000000005', 'bd1037ad38446e093cd25c38fb76849c761a9a8b6f6368d9891069e5ca6b26b3', '0.0.0'),
  ('0000000006', 'c9a6253b2ba78178e4fb389df7dea37f19371d55484ab968eea2a480ddcc4dd5', '0.0.0'),
  ('0000000007', '93ccebf59152b87b9a3371e98952c83e29865af5e94763e843852a22dbdde1d3', '0.0.0'),
  ('0000000008', 'd3b071adff8a2daeaa484b19ee3d18751a2b77c660b627599175d94e40d53a36', '0.0.0'),
  ('0000000009', '65a7aa6e234e5bb18a22e7b6007f37433a7a2e600fad9c696e375a1ccc635587', '0.0.0'),
  ('0000000010', '11ea5dbca87c3383aad6e8fcfd56f37afedce63c0af96c4344c1eb97eeda446c', '0.0.0')
) AS evidence(version, checksum, minimum_inclusive)
WHERE applied.version = evidence.version
  AND applied.checksum = evidence.checksum;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ai_crm_migrations.applied_migrations
    WHERE version BETWEEN '0000000001' AND '0000000010'
      AND application_compatibility_minimum_inclusive IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill migration compatibility evidence because a reviewed SQL checksum does not match.';
  END IF;
END
$$;
