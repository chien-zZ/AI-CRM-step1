DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ai_crm_runtime') THEN
    RAISE EXCEPTION 'required database role ai_crm_runtime is absent' USING ERRCODE = '42704';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ai_crm_worker_runtime') THEN
    RAISE EXCEPTION 'required database role ai_crm_worker_runtime is absent' USING ERRCODE = '42704';
  END IF;

  EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM ai_crm_worker_runtime', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ai_crm_worker_runtime', current_database());
  REVOKE ALL PRIVILEGES ON SCHEMA public FROM ai_crm_worker_runtime;
  REVOKE ALL PRIVILEGES ON SCHEMA ai_crm_migrations, platform_eventing, platform_task_center FROM ai_crm_worker_runtime;
  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ai_crm_migrations, platform_eventing, platform_task_center FROM ai_crm_worker_runtime;

  GRANT USAGE ON SCHEMA ai_crm_migrations, platform_eventing, platform_task_center TO ai_crm_worker_runtime;
  GRANT SELECT ON ai_crm_migrations.applied_migrations TO ai_crm_worker_runtime;
  GRANT SELECT, INSERT ON platform_eventing.inbox_receipts TO ai_crm_worker_runtime;
  GRANT INSERT ON platform_eventing.isolations TO ai_crm_worker_runtime;
  GRANT SELECT, UPDATE ON platform_eventing.outbox_messages TO ai_crm_worker_runtime;
  GRANT SELECT, INSERT, UPDATE ON platform_task_center.task_projections TO ai_crm_worker_runtime;
  GRANT SELECT, INSERT ON platform_task_center.projection_events TO ai_crm_worker_runtime;

  GRANT USAGE ON SCHEMA file_center, platform_notifications, platform_task_center TO ai_crm_runtime;
  GRANT SELECT, INSERT ON file_center.files TO ai_crm_runtime;
  GRANT SELECT, INSERT, UPDATE ON file_center.content_versions, file_center.upload_sessions, file_center.operation_receipts TO ai_crm_runtime;
  GRANT SELECT ON file_center.resource_links TO ai_crm_runtime;
  GRANT INSERT ON file_center.outbox_events TO ai_crm_runtime;
  GRANT SELECT ON platform_notifications.in_app_notifications, platform_task_center.task_projections TO ai_crm_runtime;
END
$$;
