create schema if not exists platform_notifications;

create table platform_notifications.template_releases (
  template_key varchar(255) not null,
  version integer not null check (version > 0),
  owner_reference varchar(255) not null,
  notification_type varchar(255) not null,
  variable_schema jsonb not null,
  title_template varchar(8000) not null,
  body_template varchar(8000) not null,
  content_digest char(64) not null,
  published_at timestamptz not null,
  primary key (template_key,version)
);

create table platform_notifications.notification_intents (
  intent_id uuid primary key,
  producer varchar(255) not null,
  idempotency_key varchar(255) not null,
  fingerprint char(64) not null,
  result_json jsonb not null,
  created_at timestamptz not null,
  unique (producer,idempotency_key)
);

create table platform_notifications.in_app_notifications (
  notification_id uuid primary key,
  intent_id uuid not null references platform_notifications.notification_intents(intent_id),
  principal_id varchar(255) not null,
  recipient_reference varchar(255) not null,
  resolution_reference varchar(255) not null,
  resolution_version varchar(255) not null,
  template_key varchar(255) not null,
  template_version integer not null,
  notification_type varchar(255) not null,
  title varchar(512) not null,
  body varchar(8000) not null,
  source_type varchar(255) not null,
  source_id varchar(255) not null,
  deep_link jsonb not null,
  preference_decision varchar(16) not null check (preference_decision in ('deliver','suppress')),
  preference_reason varchar(255) not null,
  preference_version varchar(255) not null,
  created_at timestamptz not null,
  read_at timestamptz,
  archived_at timestamptz,
  unique (intent_id,principal_id,recipient_reference),
  foreign key (template_key,template_version) references platform_notifications.template_releases(template_key,version)
);
create index in_app_notifications_principal_feed_idx on platform_notifications.in_app_notifications (principal_id,created_at desc,notification_id desc) where preference_decision='deliver';
create index in_app_notifications_principal_unread_idx on platform_notifications.in_app_notifications (principal_id) where preference_decision='deliver' and read_at is null and archived_at is null;

comment on schema platform_notifications is 'Notification intents, immutable template releases, recipient snapshots, preference decisions, and in-app user state.';
