create schema if not exists platform_task_center;

create table platform_task_center.task_projections (
  projection_id uuid primary key,
  source_type varchar(255) not null,
  source_task_id varchar(255) not null,
  source_version integer not null check (source_version > 0),
  status varchar(16) not null check (status in ('open','completed','cancelled')),
  app_id varchar(255) not null,
  route_id varchar(255) not null,
  assignee_reference varchar(255),
  candidate_scope_reference varchar(255),
  due_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (source_type, source_task_id)
);
create index task_projections_status_source_idx on platform_task_center.task_projections (status,source_type,source_task_id);

create table platform_task_center.projection_events (
  event_id uuid primary key,
  source_type varchar(255) not null,
  source_task_id varchar(255) not null,
  source_version integer not null check (source_version > 0),
  payload_sha256 char(64) not null,
  processed_at timestamptz not null
);
create index projection_events_source_idx on platform_task_center.projection_events (source_type,source_task_id,source_version);

create table platform_task_center.task_commands (
  idempotency_key varchar(255) primary key,
  fingerprint char(64) not null,
  status varchar(16) not null check (status in ('running','accepted')),
  source_command_id varchar(255),
  command_lease_token uuid,
  command_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='accepted' and source_command_id is not null and command_lease_token is null and command_lease_expires_at is null) or (status='running' and source_command_id is null and command_lease_token is not null and command_lease_expires_at is not null))
);

comment on schema platform_task_center is 'Task Center owned projection and idempotent source-command routing state.';
