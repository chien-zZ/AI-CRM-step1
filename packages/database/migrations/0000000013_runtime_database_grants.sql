DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ai_crm_runtime') THEN
    RAISE EXCEPTION 'required database role ai_crm_runtime is absent' USING ERRCODE = '42704';
  END IF;

  EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM ai_crm_runtime', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ai_crm_runtime', current_database());

  REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
  REVOKE ALL PRIVILEGES ON SCHEMA public FROM ai_crm_runtime;

  REVOKE ALL PRIVILEGES ON SCHEMA
    ai_crm_migrations,
    app_registry,
    audit,
    authorization_core,
    business_configuration,
    file_center,
    form_schema,
    organization,
    platform_eventing,
    platform_notifications,
    platform_task_center
  FROM ai_crm_runtime;

  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA
    ai_crm_migrations,
    app_registry,
    audit,
    authorization_core,
    business_configuration,
    file_center,
    form_schema,
    organization,
    platform_eventing,
    platform_notifications,
    platform_task_center
  FROM ai_crm_runtime;

  GRANT USAGE ON SCHEMA ai_crm_migrations TO ai_crm_runtime;
  GRANT SELECT ON ai_crm_migrations.applied_migrations TO ai_crm_runtime;

  GRANT USAGE ON SCHEMA organization TO ai_crm_runtime;
  GRANT SELECT ON
    organization.assignments,
    organization.employments,
    organization.organization_unit_placements,
    organization.organization_units,
    organization.positions,
    organization.subject_associations
  TO ai_crm_runtime;

  GRANT USAGE ON SCHEMA authorization_core TO ai_crm_runtime;
  GRANT SELECT ON
    authorization_core.current_policy,
    authorization_core.policy_publications,
    authorization_core.policy_versions
  TO ai_crm_runtime;
  GRANT SELECT, INSERT ON authorization_core.decision_records TO ai_crm_runtime;

  GRANT USAGE ON SCHEMA audit TO ai_crm_runtime;
  GRANT SELECT, INSERT ON audit.records TO ai_crm_runtime;
  GRANT SELECT, INSERT, UPDATE ON audit.operation_receipts TO ai_crm_runtime;

  GRANT USAGE ON SCHEMA app_registry TO ai_crm_runtime;
  GRANT SELECT ON
    app_registry.applications,
    app_registry.navigation,
    app_registry.routes
  TO ai_crm_runtime;

  GRANT USAGE ON SCHEMA form_schema TO ai_crm_runtime;
  GRANT SELECT ON form_schema.releases, form_schema.release_status TO ai_crm_runtime;
END
$$;
